import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { Gate, browserFence } from '../src/gate.js';
import { CfError } from '../src/common.js';
import { DshAdapter } from '../src/dsh.js';
import { HOST, http, dshFixture } from './helpers.js';
const headers = { host: HOST, origin: `https://${HOST}`, 'cf-access-jwt-assertion': 'owner-test-jwt', 'sec-fetch-site': 'same-origin' };
async function fixture(t, { upstreamHost = '127.0.0.1', ...options } = {}) {
  const upstream = await dshFixture({ host: upstreamHost }); const adapter = new DshAdapter(upstream.ctx); await adapter.trust(HOST);
  const evidence = [];
  const gate = new Gate({ host: HOST, instanceId: 'instance-test', adapter, verify: async token => { assert.equal(token, 'owner-test-jwt'); return { expiresAt: Date.now() + 60_000 }; }, onEvidence: x => evidence.push(x), ...options });
  await gate.start(); t.after(async () => { await gate.close(); await upstream.close(); });
  return { upstream, adapter, gate, evidence, activate: () => http(gate.port, { path: '/', headers }) };
}
async function until(check) {
  for (let i = 0; !check() && i < 200; i++) await new Promise(r => setTimeout(r, 10));
  assert(check(), 'condition did not complete');
}
function websocket(port, path = '/api/stream') {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { ...headers, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' } });
    req.once('error', reject);
    req.once('upgrade', (response, socket) => { socket.on('error', () => {}); resolve({ status: response.statusCode, socket }); });
    req.once('response', response => { response.resume(); response.once('end', () => resolve({ status: response.statusCode })); });
    req.end();
  });
}
test('closing one browser keeps WebSocket evidence while another upgraded socket remains active', async t => {
  const faults = [], f = await fixture(t, { onFault: value => faults.push(value) });
  await f.activate();
  const a = await websocket(f.gate.port), b = await websocket(f.gate.port);
  t.after(() => { a.socket.destroy(); b.socket.destroy(); });
  assert.equal(f.gate.websockets.size, 2);
  a.socket.destroy(); await until(() => f.gate.websockets.size === 1);
  assert.equal(faults.length, 0);
  const data = once(b.socket, 'data'); b.socket.write('still-alive');
  assert.equal((await data)[0].toString(), 'still-alive');
  b.socket.destroy(); await until(() => f.gate.websockets.size === 0);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(faults.length, 0, 'the last tab closing is not a fault');
});
async function halfOpenUpgrade(t, port, upgrade = 'websocket') {
  const socket = connect({ host: '127.0.0.1', port, allowHalfOpen: true });
  t.after(() => socket.destroy());
  const chunks = []; socket.on('data', chunk => chunks.push(chunk));
  socket.on('error', () => {});
  await once(socket, 'connect');
  const ended = once(socket, 'end');
  socket.write(`GET /api/stream HTTP/1.1\r\nHost: ${HOST}\r\nOrigin: https://${HOST}\r\nConnection: Upgrade\r\nUpgrade: ${upgrade}\r\n\r\n`);
  await ended;
  assert.equal(socket.writable, true, 'peer deliberately leaves its write side open');
  return Buffer.concat(chunks).toString();
}
for (const upgrade of ['websocket', 'unsupported']) test(`rejected ${upgrade} closes the server socket without waiting for peer FIN`, async t => {
  const f = await fixture(t);
  assert.match(await halfOpenUpgrade(t, f.gate.port, upgrade), /^HTTP\/1.1 401 /);
  await until(() => f.gate.requests === 0 && f.gate.sockets.size === 0);
  assert.equal(f.upstream.exchanges, 0);
  assert.equal((await f.activate()).status, 200);
});
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
  assert.equal(r.status, 401); assert.equal(f.upstream.exchanges, 0);
});
test('normal owner navigation verifies DSH automatically; cookies stay server-side and Host/Origin survive', async t => {
  const f = await fixture(t); assert.equal((await http(f.gate.port, { headers })).status, 200);
  assert.equal(f.upstream.exchanges, 1);
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
test('a slow DSH response is forwarded within the upstream header window, and a stuck one becomes 502', async t => {
  const f = await fixture(t, { upstreamHeadersMs: 1500 }); await f.activate();
  const slow = await http(f.gate.port, { path: '/api/slow?ms=400', headers }); assert.equal(slow.status, 200); assert.equal(slow.body, 'slow-ok');
  const stuck = await http(f.gate.port, { path: '/api/slow?ms=4000', headers }); assert.equal(stuck.status, 502);
  assert.equal(f.gate.server.requestTimeout, f.gate.maximumStreamMs);
});
test('a slow upload longer than the response-header window is not cut: the window starts after the body is sent', async t => {
  const f = await fixture(t, { upstreamHeadersMs: 300 }); await f.activate();
  const result = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: f.gate.port, method: 'POST', path: '/api/echo', headers: { ...headers, 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' } }, res => { const c = []; res.on('data', x => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() })); });
    req.on('error', reject); let n = 0;
    const timer = setInterval(() => { req.write(`part-${n}|`); if (++n === 6) { clearInterval(timer); req.end(); } }, 150); // ~900 ms upload
  });
  assert.equal(result.status, 200); assert.equal(JSON.parse(result.body).received, 'part-0|part-1|part-2|part-3|part-4|part-5|');
});
test('default upstream window matches the Cloudflare edge origin timeout, not a short local cut-off', () => {
  const gate = new Gate({ host: HOST, instanceId: 'i', adapter: {}, verify: null });
  assert.equal(gate.upstreamHeadersMs, 100_000); assert.equal(gate.maximumBodyBytes, 100 * 1024 * 1024);
});
test('a trustedHosts edit refused by DSH is reported with a safe, actionable error', async t => {
  const upstream = await dshFixture(); t.after(() => upstream.close());
  upstream.ctx.get('configEditor').edit = async () => { throw new Error('Configuration for "connection" is overridden by a home patch or command-line overlay'); };
  await assert.rejects(new DshAdapter(upstream.ctx).trust('other.example.com'), e => e.code === 'DSH_CONFIG' && /--trusted-host/.test(e.message) && !/home patch or command-line overlay/.test(e.message));
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
test('parallel WebSocket authentication reserves at most 64 slots and releases them on close', async t => {
  const f = await fixture(t); await f.activate();
  let release, verifying = 0, rejected = 0; const waiting = new Promise(r => { release = r; });
  f.gate.verify = async () => { verifying++; await waiting; return { expiresAt: Date.now() + 60_000 }; };
  t.after(() => release());
  const attempts = Array.from({ length: 80 }, () => websocket(f.gate.port).then(r => { if (r.status === 503) rejected++; return r; }));
  await until(() => rejected === 16 && verifying === 64);
  assert.equal(f.gate.upgrades, 64); release();
  const results = await Promise.all(attempts); assert.equal(results.filter(r => r.status === 101).length, 64);
  assert.equal(f.gate.active.size, 64);
  for (const result of results) result.socket?.destroy();
  await until(() => f.gate.upgrades === 0 && f.gate.active.size === 0);
  assert.equal((await http(f.gate.port, { headers })).status, 200);
});
test('WebSockets and HTTP requests have separate budgets, and failed authentication releases reservations', async t => {
  const f = await fixture(t, { maximumRequests: 3, maximumWebSockets: 2 }); await f.activate();
  let release, verifying = 0; const waiting = new Promise(r => { release = r; });
  f.gate.verify = async () => { verifying++; await waiting; throw new Error('invalid JWT'); }; t.after(() => release());
  const requests = Array.from({ length: 3 }, () => http(f.gate.port, { headers }));
  await until(() => verifying === 3);
  assert.equal((await http(f.gate.port, { headers })).status, 503, 'the HTTP budget is full');
  const sockets = Array.from({ length: 2 }, () => websocket(f.gate.port));
  await until(() => verifying === 5);
  assert.equal(f.gate.requests, 3); assert.equal(f.gate.upgrades, 2, 'sockets did not use the HTTP budget');
  assert.equal((await websocket(f.gate.port)).status, 503);
  assert.match(await halfOpenUpgrade(t, f.gate.port), /^HTTP\/1.1 503 /);
  assert.equal(f.gate.requests, 3, 'capacity rejection does not consume or release another request’s slot');
  release(); assert((await Promise.all(requests)).every(r => r.status === 401));
  assert((await Promise.all(sockets)).every(r => r.status === 401));
  await until(() => f.gate.requests === 0 && f.gate.upgrades === 0);
});
test('the default budgets are 256 HTTP requests and 64 WebSockets', () => {
  const gate = new Gate({ host: HOST, instanceId: 'i', adapter: {}, verify: null });
  assert.equal(gate.maximumRequests, 256); assert.equal(gate.maximumWebSockets, 64);
});
test('disconnecting during WebSocket authentication does not release unfinished admission work', async t => {
  const f = await fixture(t); await f.activate();
  let release, verifying = 0; const waiting = new Promise(r => { release = r; });
  f.gate.verify = async () => { verifying++; await waiting; return { expiresAt: Date.now() + 60_000 }; }; t.after(() => release());
  const clients = Array.from({ length: 64 }, () => {
    const req = request({ host: '127.0.0.1', port: f.gate.port, path: '/api/stream', headers: { ...headers, connection: 'Upgrade', upgrade: 'websocket' } });
    req.on('error', () => {}); req.end(); return req;
  });
  await until(() => verifying === 64); for (const req of clients) req.destroy();
  await until(() => f.gate.sockets.size === 0);
  assert.equal(f.gate.upgrades, 64, 'pending verification retains its reservation after disconnect');
  assert.equal((await websocket(f.gate.port)).status, 503); assert.equal(verifying, 64);
  const calls = f.upstream.calls.length; release(); await until(() => f.gate.upgrades === 0);
  assert.equal(f.upstream.calls.length, calls, 'closed clients do not start a session exchange');
});
test('WebSocket JWT expiry during a delayed session exchange cannot reach upstream', async t => {
  const f = await fixture(t); await f.activate();
  let release, exchanging = false; const waiting = new Promise(r => { release = r; });
  const identity = { expiresAt: Date.now() + 60_000 }; f.gate.verify = async () => identity;
  f.adapter.cookie = async () => { exchanging = true; await waiting; return 'dsh-auth-fixture=unused'; }; t.after(() => release());
  const attempt = websocket(f.gate.port).catch(() => null);
  await until(() => exchanging); identity.expiresAt = Date.now() - 1; release(); await attempt;
  await until(() => f.gate.upgrades === 0);
  assert(!f.upstream.calls.some(c => c.upgrade));
});
// Some sandboxes have no IPv6 at all; the ::1 case is skipped there instead of reported as a failure.
const ipv6 = await new Promise(resolve => { const probe = createServer(); probe.once('error', () => resolve(false)); probe.listen(0, '::1', () => probe.close(() => resolve(true))); });
for (const upstreamHost of ['127.0.0.1', '::1', 'localhost']) test(`DSH cookie exchange and HTTP/WS forwarding work with ${upstreamHost} listener`, { skip: upstreamHost === '::1' && !ipv6 ? 'this host cannot bind ::1' : false }, async t => {
  const f = await fixture(t, { upstreamHost });
  assert.equal((await f.activate()).status, 200);
  assert.equal((await http(f.gate.port, { path: '/api/read', headers })).status, 200);
  const ws = await websocket(f.gate.port); assert.equal(ws.status, 101); ws.socket.destroy();
  assert.equal(f.upstream.exchanges, 1);
  assert.equal(f.upstream.calls.at(-1).headers.host, HOST);
});
test('localhost lookup supplies only IPv4/IPv6 loopback addresses', async t => {
  const f = await fixture(t, { upstreamHost: 'localhost' }); const target = await f.adapter.target(HOST);
  assert.equal(target.autoSelectFamily, true);
  target.lookup('localhost', { all: true }, (error, addresses) => { assert.equal(error, null); assert.deepEqual(addresses, [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }]); });
});
test('expired JWT is rejected before DSH is contacted', async t => {
  const f = await fixture(t, { verify: async () => ({ expiresAt: Date.now() - 1 }) });
  assert.equal((await f.activate()).status, 401); assert.equal(f.upstream.calls.length, 0);
});
test('in-flight JWT verification cannot reach DSH after stop', async t => {
  let finish; const proof = new Promise(r => { finish = r; });
  const f = await fixture(t, { verify: () => proof }); const pending = f.activate().catch(() => null);
  await new Promise(r => setTimeout(r, 25)); await f.gate.close(); finish({ expiresAt: Date.now() + 10000 }); await pending;
  assert.equal(f.upstream.exchanges, 0); assert.equal(f.upstream.calls.length, 0);
});
test('public settings may read sanitized status, but cannot mutate connector configuration', () => {
  assert.equal(browserFence({ url: '/dsh-cf/status', method: 'POST', headers }, HOST).pathname, '/dsh-cf/status');
  for (const path of ['/dsh-cf/start', '/dsh-cf/pause', '/dsh-cf/authorize', '/dsh-cf/remove', '/dsh-cf/pending/resolve', '/dsh%2dcf/status']) assert.throws(() => browserFence({ url: path, method: 'POST', headers }, HOST));
});
test('public Cloudflare gate refuses every management operation before reaching DSH', async t => {
  const f = await fixture(t); await f.activate();
  const before = f.upstream.calls.length;
  for (const endpoint of ['pause', 'start', 'pending/resolve', 'update-install']) {
    const result = await http(f.gate.port, { path: `/dsh-cf/${endpoint}`, method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'public', method: endpoint, payload: {} }) });
    assert.equal(result.status, 403);
  }
  assert.equal(f.upstream.calls.length, before);
});
test('a loopback Host is rejected and is not treated as the operator', async t => {
  assert.throws(() => browserFence({ url: '/', method: 'GET', headers: { ...headers, host: '127.0.0.1' } }, HOST));
  assert.throws(() => browserFence({ url: '/', method: 'GET', headers: { ...headers, host: 'localhost' } }, HOST));
  const f = await fixture(t); await f.activate();
  const result = await http(f.gate.port, { headers: { ...headers, host: '127.0.0.1:443' } });
  assert.equal(result.status, 403);
  assert.equal(f.upstream.calls.filter(call => call.path === '/' && call.headers.host === '127.0.0.1:443').length, 0);
});
test('upstream 503 and 401 are faults, while success and gate shutdown are not', async t => {
  const faults = [];
  const f = await fixture(t, { onFault: event => faults.push(event) });
  await f.activate();
  assert.equal((await http(f.gate.port, { headers })).status, 200);
  assert.equal(faults.length, 0);
  const down = await http(f.gate.port, { path: '/api/down', headers });
  assert.equal(down.status, 503);
  assert.deepEqual(faults.at(-1), { status: 'upstream-failed', channel: 'api', httpStatus: 503 });
  assert.equal(f.evidence.includes('api'), false);
  const denied = await http(f.gate.port, { path: '/api/fail', method: 'POST', headers, body: 'once' });
  assert.equal(denied.status, 401);
  assert.deepEqual(faults.at(-1), { status: 'auth-rejected', channel: 'api' });
  const beforeClose = faults.length;
  await f.gate.close();
  assert.equal(faults.length, beforeClose);
});
test('a WebSocket upgrade 5xx keeps the earlier successful check', async t => {
  const faults = [];
  const f = await fixture(t, { onFault: event => faults.push(event) });
  await f.activate();
  const ws = await websocket(f.gate.port);
  assert.equal(ws.status, 101);
  assert.equal(f.evidence.includes('websocket'), true);
  ws.socket.destroy();
  const down = await websocket(f.gate.port, '/api/down').catch(() => ({ status: 0 }));
  if (down.status) assert.equal(down.status, 503);
  await until(() => faults.some(event => event.channel === 'websocket' && event.httpStatus === 503));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(faults.filter(event => event.httpStatus === 503), [{ status: 'upstream-failed', channel: 'websocket', httpStatus: 503 }]);
  assert.equal(f.evidence.includes('websocket'), true);
  assert.equal(faults.filter(event => event.status === 'upstream-failed' && event.httpStatus === undefined && event.channel === 'websocket').length, 0);
});
test('a later HTTP 5xx is forwarded without removing the earlier successful check', async t => {
  const faults = [];
  const f = await fixture(t, { onFault: event => faults.push(event) });
  await f.activate();
  assert.equal((await http(f.gate.port, { headers })).status, 200);
  assert.equal(f.evidence.includes('http'), true);
  const down = await http(f.gate.port, { path: '/down', headers });
  assert.equal(down.status, 503);
  assert.equal(down.body, 'unavailable');
  assert.deepEqual(faults.filter(event => event.channel === 'http'), [{ status: 'upstream-failed', channel: 'http', httpStatus: 503 }]);
  assert.equal(f.evidence.includes('http'), true);
});
test('WebSocket end and the stream lifetime are not faults', async t => {
  const faults = [];
  const f = await fixture(t, { onFault: event => faults.push(event), maximumStreamMs: 300 });
  await f.activate();
  const ws = await websocket(f.gate.port);
  assert.equal(ws.status, 101);
  await once(ws.socket, 'close');
  await until(() => f.gate.websockets.size === 0);
  assert.deepEqual(faults, []);
  ws.socket.destroy();
});

test('API calls and WebSockets from a tab that never loaded the homepage work: the DSH session is exchanged lazily', async t => {
  const f = await fixture(t);
  assert.equal(f.upstream.exchanges, 0);
  const api = await http(f.gate.port, { path: '/api/before', method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(api.status, 200); assert.equal(f.upstream.exchanges, 1);
  assert(f.evidence.includes('owner')); assert(f.evidence.includes('api'));
  const ws = await websocket(f.gate.port); assert.equal(ws.status, 101); ws.socket.destroy();
  assert(f.evidence.includes('websocket'));
  assert.equal((await http(f.gate.port, { path: '/', headers })).status, 200);
  assert(f.evidence.includes('http')); assert.equal(f.upstream.exchanges, 1);
});
test('a WebSocket opened before any other request is admitted after the lazy exchange', async t => {
  const f = await fixture(t);
  const ws = await websocket(f.gate.port); assert.equal(ws.status, 101); ws.socket.destroy();
  assert.equal(f.upstream.exchanges, 1); assert(f.evidence.includes('owner'));
});

test('a failed DSH cookie exchange is a DSH problem, not a sign-in problem, and records no owner evidence', async t => {
  const faults = [], f = await fixture(t, { onFault: event => faults.push(event) });
  f.adapter.cookie = async () => { throw new CfError('DSH_CONNECTION', 'private diagnostic'); };
  const r = await http(f.gate.port, { headers });
  assert.equal(r.status, 502); assert.equal(f.evidence.includes('owner'), false);
  assert.equal(r.body.includes('private diagnostic'), false);
  assert.deepEqual(faults.at(-1), { status: 'upstream-failed', channel: 'http' });
  const page = await http(f.gate.port, { headers: { ...headers, accept: 'text/html' } });
  assert.equal(page.status, 502); assert.match(page.body, /DSH/); assert.doesNotMatch(page.body, /logout/);
});

test('owner evidence is recorded only after the DSH cookie exchange succeeded, and never after a stop', async t => {
  const f = await fixture(t); let finish;
  f.adapter.cookie = () => new Promise(resolve => { finish = resolve; });
  const pending = http(f.gate.port, { headers }).catch(() => null);
  await until(() => !!finish); const closing = f.gate.close(); finish('not-a-browser-cookie');
  await Promise.all([pending, closing]);
  assert.equal(f.evidence.includes('owner'), false);
});

test('browser entry errors explain how to recover without exposing raw authentication errors', async t => {
  const f = await fixture(t, { verify: async () => { throw new Error('private bearer secret'); } });
  const result = await http(f.gate.port, { headers: { ...headers, accept: 'text/html', 'accept-language': 'ja' } });
  assert.equal(result.status, 401); assert.match(result.headers['content-type'], /text\/html/);
  assert.match(result.body, /ログインし直す/); assert.equal(result.body.includes('private bearer secret'), false);
  assert.equal(f.upstream.exchanges, 0);
  assert.match(result.body, /prefers-color-scheme:dark/);
});

test('a signed-in account that is not the owner is told so and offered the Access logout', async t => {
  const f = await fixture(t, { verify: async () => { throw new CfError('AUTH_OWNER', 'This account is not allowed.'); } });
  for (const [language, text] of [['en', /not allowed/], ['ja', /許可されていません/]]) {
    const result = await http(f.gate.port, { headers: { ...headers, accept: 'text/html', 'accept-language': language } });
    assert.equal(result.status, 401); assert.match(result.body, text); assert.match(result.body, /cdn-cgi\/access\/logout/);
  }
  assert.equal(f.upstream.exchanges, 0);
});

test('an unreachable key endpoint is a 503 "try again" page with no sign-out link, and API callers get 503 too', async t => {
  const faults = [], f = await fixture(t, { verify: async () => { throw new CfError('AUTH_UNAVAILABLE', 'keys'); }, onFault: event => faults.push(event) });
  const page = await http(f.gate.port, { headers: { ...headers, accept: 'text/html', 'accept-language': 'ja' } });
  assert.equal(page.status, 503); assert.match(page.body, /ログインし直す必要はありません/); assert.doesNotMatch(page.body, /logout/); assert.match(page.body, /prefers-color-scheme:dark/);
  const english = await http(f.gate.port, { headers: { ...headers, accept: 'text/html' } });
  assert.match(english.body, /could not verify the sign-in with Cloudflare/); assert.doesNotMatch(english.body, /Sign in again/);
  assert.equal((await http(f.gate.port, { path: '/api/x', method: 'POST', headers, body: '{}' })).status, 503);
  assert.equal((await websocket(f.gate.port)).status, 503);
  assert.equal(faults.at(-1).status, 'verification-unavailable'); assert.equal(f.upstream.exchanges, 0);
});

test('a healthy response reports recovery, and DSH 5xx/401 remain faults', async t => {
  const events = [], f = await fixture(t, { onFault: event => events.push(['fault', event.status]), onHealthy: () => events.push(['healthy']) });
  await http(f.gate.port, { path: '/api/down', headers });
  await http(f.gate.port, { path: '/api/read', headers });
  assert.deepEqual(events.slice(0, 2), [['fault', 'upstream-failed'], ['healthy']]);
});
