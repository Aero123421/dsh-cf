import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { Gate, browserFence, DIAGNOSTIC_PATH } from '../src/gate.js';
import { DshAdapter } from '../src/dsh.js';
import { HOST, http, dshFixture } from './helpers.js';
const headers = { host: HOST, origin: `https://${HOST}`, 'cf-access-jwt-assertion': 'owner-test-jwt', 'sec-fetch-site': 'same-origin' };
async function fixture(t, options = {}) {
  const upstream = await dshFixture(); const adapter = new DshAdapter(upstream.ctx); await adapter.trust(HOST);
  const evidence = [];
  const gate = new Gate({ host: HOST, instanceId: 'instance-test', adapter, verify: async token => { assert.equal(token, 'owner-test-jwt'); return { expiresAt: Date.now() + 60_000 }; }, onEvidence: x => evidence.push(x), ...options });
  await gate.start(); t.after(async () => { await gate.close(); await upstream.close(); });
  return { upstream, adapter, gate, evidence, activate: () => http(gate.port, { path: `${DIAGNOSTIC_PATH}?challenge=${gate.proofNonce}`, headers }) };
}
for (const [name, patch] of [
  ['wrong Host', { headers: { ...headers, host: 'evil.example.com' } }],
  ['wrong Origin', { headers: { ...headers, origin: 'https://evil.example.com' } }],
  ['opaque Origin', { headers: { ...headers, origin: 'null' } }],
  ['cross-site API read', { url: '/api/read', headers: { ...headers, 'sec-fetch-site': 'cross-site' } }],
  ['mutation without Origin', { method: 'POST', headers: { host: HOST } }],
  ['management route', { url: '/dsh-cf/status' }],
  ['encoded management route', { url: '/dsh%2Dcf/status' }],
  ['double-encoded route', { url: '/%2564sh-cf/status' }],
  ['encoded separator', { url: '/dsh-cf%2fstatus' }],
  ['launch token on public URL', { url: '/?token=anything' }],
  ['absolute-form target', { url: 'https://example.com/' }],
  ['network-path target', { url: '//example.com/' }],
]) test(`fence rejects ${name}`, () => assert.throws(() => browserFence({ url: '/', method: 'GET', headers, ...patch }, HOST)));
test('safe cross-site entry is allowed, but not POST or an API path', () => {
  const req = { url: '/', method: 'GET', headers: { host: HOST, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } };
  assert.equal(browserFence(req, HOST).pathname, '/');
  assert.throws(() => browserFence({ ...req, method: 'POST' }, HOST));
});
test('whole-surface gate rejects missing JWT and does not exchange a DSH token', async t => {
  const f = await fixture(t); const r = await http(f.gate.port, { headers: { host: HOST } });
  assert.equal(r.status, 401); assert.equal(f.upstream.exchanges, 0); assert.equal(f.gate.enabled, false);
});
test('owner proof is required; DSH cookie stays server-side and real public Host/Origin survive', async t => {
  const f = await fixture(t); assert.equal((await http(f.gate.port, { headers })).status, 401);
  assert.equal((await f.activate()).status, 200); assert.equal(f.upstream.exchanges, 1);
  const result = await http(f.gate.port, { headers: { ...headers, cookie: 'attacker=value', authorization: 'Bearer NOT-FOR-UPSTREAM', 'x-forwarded-host': 'evil.example.com' } });
  assert.equal(result.status, 200); assert.equal(result.headers['set-cookie'], undefined);
  const received = f.upstream.calls.at(-1).headers;
  assert.equal(received.host, HOST); assert.equal(received.origin, headers.origin);
  assert.match(received.cookie, /^dsh-auth-/); assert(!received.cookie.includes('attacker'));
  for (const key of ['authorization', 'cf-access-jwt-assertion', 'x-forwarded-host']) assert.equal(received[key], undefined);
  assert(f.evidence.includes('owner')); assert(f.evidence.includes('http'));
});
test('real HTTP POST passes byte content once and API evidence is recorded', async t => {
  const f = await fixture(t); await f.activate();
  const body = JSON.stringify({ message: 'こんにちは', attachment: 'one' });
  const result = await http(f.gate.port, { path: '/api/echo', method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body });
  assert.equal(result.status, 200); assert.equal(JSON.parse(result.body).received, body); assert(f.evidence.includes('api'));
});
test('upstream 401 never replays a non-idempotent POST', async t => {
  const f = await fixture(t); await f.activate();
  const result = await http(f.gate.port, { path: '/api/fail', method: 'POST', headers, body: 'do-not-replay' });
  assert.equal(result.status, 401); assert.equal(f.upstream.calls.filter(r => r.path === '/api/fail').length, 1);
});
test('bounded uploads fail before forwarding oversized declared bodies', async t => {
  const f = await fixture(t, { maximumBodyBytes: 4 }); await f.activate();
  const result = await http(f.gate.port, { path: '/api/echo', method: 'POST', headers: { ...headers, 'content-length': '5' }, body: '12345' });
  assert.equal(result.status, 413); assert(!f.upstream.calls.some(x => x.path === '/api/echo'));
});
test('DSH launch-token rotation re-exchanges over loopback; trust edit retains other fields', async t => {
  const f = await fixture(t); await f.activate();
  assert.deepEqual(f.upstream.raw.recovery, { retries: 3 }); assert(f.upstream.raw.trustedHosts.includes('keep.example.com'));
  f.upstream.rotate(); assert.equal((await http(f.gate.port, { headers })).status, 200); assert.equal(f.upstream.exchanges, 2);
});
test('WebSocket handshake and bytes traverse authenticated gate; close tears down open sockets', async t => {
  const f = await fixture(t); await f.activate();
  const req = request({ host: '127.0.0.1', port: f.gate.port, path: '/api/stream', headers: { ...headers, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' } });
  req.end(); const [response, socket] = await once(req, 'upgrade'); socket.on('error', () => {});
  assert.equal(response.statusCode, 101); assert(f.evidence.includes('websocket'));
  const next = once(socket, 'data'); socket.write(Buffer.from([0x81, 0x02, 0x68, 0x69])); assert.deepEqual((await next)[0], Buffer.from([0x81, 0x02, 0x68, 0x69]));
  const closed = once(socket, 'close'); await f.gate.close(); await closed;
});
test('expired JWT is rejected before DSH is contacted', async t => {
  const f = await fixture(t, { verify: async () => ({ expiresAt: Date.now() - 1 }) });
  assert.equal((await f.activate()).status, 401); assert.equal(f.upstream.calls.length, 0);
});
test('in-flight JWT verification cannot enable a gate after stop', async t => {
  let finish; const proof = new Promise(r => { finish = r; });
  const f = await fixture(t, { verify: () => proof }); const pending = f.activate().catch(() => null);
  await new Promise(r => setTimeout(r, 25)); await f.gate.close(); finish({ expiresAt: Date.now() + 10000 }); await pending;
  assert.equal(f.gate.enabled, false); assert.equal(f.upstream.exchanges, 0);
});
test('public settings may read sanitized status, but cannot mutate connector configuration', () => {
  assert.equal(browserFence({ url: '/dsh-cf/status', method: 'POST', headers }, HOST).pathname, '/dsh-cf/status');
  for (const path of ['/dsh-cf/start', '/dsh-cf/authorize', '/dsh-cf/remove', '/dsh%2dcf/status']) assert.throws(() => browserFence({ url: path, method: 'POST', headers }, HOST));
});
