import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, access, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index.js';
import { endpointOf, isManagementRequest, rpcRoute } from '../src/rpc.js';
import { listen, http, freePort } from './helpers.js';

const COOKIE = 'dsh-auth-fixture=ok';
/** Minimal DSH host: WebServer prefix routes over real loopback HTTP, and Connection's admission fence. */
async function dshHost(t, { manager, config } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cf-plugin-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const anchor = join(dir, 'runtime/package.json');
  await mkdir(join(dir, 'runtime/node_modules/@deepseek-ai/dsh-app-boot'), { recursive: true });
  await writeFile(anchor, '{}'); await writeFile(join(dir, 'runtime/node_modules/@deepseek-ai/dsh-app-boot/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version: '0.2.1-alpha.2' }));
  const routes = new Map(), disposers = [];
  const server = createServer((req, res) => {
    for (const [path, route] of routes) if (req.url === path || req.url.startsWith(`${path}/`)) return void route.handler(req, res);
    res.writeHead(405); res.end(); // DSH's static fallback answers unclaimed non-GET requests with 405
  });
  const port = await listen(server); t.after(() => new Promise(r => server.close(r)));
  const webServer = { host: '127.0.0.1', port, protocol: 'http:', register: route => { assert(!routes.has(route.path), 'duplicate route'); routes.set(route.path, route); return () => routes.delete(route.path); } };
  const connection = {
    // DSH 0.2.1-alpha.2: rpc.handle() resolves webServer inside Connection's own fiber and throws for plugin contexts.
    rpc: { handle() { throw new Error('cannot get property "webServer" without inject'); } },
    requestRejection: req => req.headers.host !== `127.0.0.1:${port}` ? 403 : req.headers.cookie === COOKIE ? undefined : 401,
    authenticatedUrl: base => `${base}?token=t`,
  };
  const ctx = {
    profileContext: { dir, installAnchor: anchor },
    effect(fn) { const dispose = fn(); disposers.push(dispose); return dispose; },
    inject(_deps, callback) { callback({ connection, webServer, effect: ctx.effect }); },
    get: name => ({ connection, webServer, pluginManager: manager })[name],
  };
  await apply(ctx, { stateDirectory: join(dir, '.dsh-cf'), ...config });
  const dispose = async () => { for (const d of disposers.splice(0).reverse()) await d(); };
  t.after(dispose);
  const call = (endpoint, { payload = {}, method = endpoint, headers = {}, body } = {}) => http(port, { path: `/dsh-cf/${endpoint}`, method: 'POST', headers: { host: `127.0.0.1:${port}`, cookie: COOKIE, 'content-type': 'application/json', ...headers }, body: body ?? JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method, payload }) });
  return { dir, routes, call, dispose, port };
}
test('the settings channel is served on WebServer even though DSH rpc.handle() cannot be used by plugins', async t => {
  const f = await dshHost(t); assert(f.routes.has('/dsh-cf'));
  const r = await f.call('status'); assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.type, 'server-response'); assert.equal(body.rpcId, 'rpc-1'); assert.equal(body.result.ok, true); assert.equal(body.result.value.phase, 'idle');
});
test('the settings channel uses DSH admission: no cookie is 401 and a foreign Host is 403', async t => {
  const f = await dshHost(t);
  assert.equal((await f.call('status', { headers: { cookie: 'other=1' } })).status, 401);
  assert.equal((await f.call('status', { headers: { host: 'evil.example.com' } })).status, 403);
});
test('the wire contract rejects malformed requests without reaching the controller', async t => {
  const f = await dshHost(t);
  assert.equal((await f.call('status', { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await f.call('status', { body: '{not json' })).status, 400);
  assert.equal((await f.call('status', { body: 'x'.repeat(70 * 1024) })).status, 413);
  const mismatch = JSON.parse((await f.call('status', { method: 'remove' })).body);
  assert.equal(mismatch.result.ok, false); assert.equal(mismatch.result.error.code, 'gateway/bad-request');
  const envelope = JSON.parse((await f.call('status', { body: JSON.stringify({ type: 'other', rpcId: 'z' }) })).body);
  assert.equal(envelope.rpcId, 'z'); assert.equal(envelope.result.error.code, 'gateway/bad-request');
  const unknown = JSON.parse((await f.call('nope')).body); assert.equal(unknown.result.ok, false); assert.equal(unknown.result.error.code, 'ENDPOINT');
});
test('endpoint paths follow the DSH segment rules', () => {
  assert.equal(endpointOf('/dsh-cf/oauth/start'), 'oauth/start');
  for (const bad of ['/dsh-cf', '/dsh-cf/', '/dsh-cf/../x', '/dsh-cf/a//b', '/dsh-cfx/status', '/dsh-cf/a b']) assert.equal(endpointOf(bad), undefined, bad);
});
test('disposing the plugin removes its route and releases profile ownership', async t => {
  const f = await dshHost(t); await f.dispose();
  assert(!f.routes.has('/dsh-cf'));
  await assert.rejects(access(join(f.dir, '.dsh-cf', 'owner.lock')));
});
test('updater routes require the original management peer, Host and Origin after DSH admission', async t => {
  const f = await dshHost(t);
  for (const endpoint of ['update-status', 'update-check', 'update-install']) {
    assert.equal((await f.call(endpoint, { headers: { origin: 'https://public.example.com' } })).status, 403);
    assert.equal((await f.call(endpoint, { headers: { 'x-forwarded-for': '127.0.0.1' } })).status, 403);
    assert.equal((await f.call(endpoint, { headers: { 'cf-connecting-ip': '127.0.0.1' } })).status, 403);
    assert.equal((await f.call(endpoint, { headers: { cookie: '' } })).status, 401);
  }
  const result = JSON.parse((await f.call('update-status')).body).result;
  assert.equal(result.ok, true); assert.equal(result.value.status, 'unavailable'); assert.equal(result.value.reason, 'UPDATE_MANAGER'); assert.equal(result.value.dshVersion, '0.2.1-alpha.2');
  const status = JSON.parse((await f.call('status')).body).result.value;
  assert.equal(status.version, '0.1.0-alpha.5'); assert.equal(status.phase, 'idle');
});
test('actual updater RPC preserves disabled state and busy responses while cloud state stays unchanged', async t => {
  const version = '0.1.0-alpha.6'; let complete, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const calls = [], bundle = { name: 'dsh-cf', installed: true, enabled: false, version: '0.1.0-alpha.5', source: 'github:Aero123421/dsh-cf#v0.1.0-alpha.5' };
  const manager = { listBundles: async () => [bundle], waitForInstall: async () => null, installBundle: async (spec, options) => { calls.push({ spec, options }); entered(); return new Promise(resolve => { complete = resolve; }); } };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async url => url.includes('/releases?') ? Response.json([{ id: 1, tag_name: 'v'+version, draft: false, prerelease: true, html_url: `https://github.com/Aero123421/dsh-cf/releases/tag/v${version}`, body: '' }]) : Response.json({ name: 'dsh-cf', version, exports: { '.': './src/index.js', './client': './src/client.js' }, dsh: { bundle: { patch: './cordis.patch.yml' } }, peerDependencies: { '@deepseek-ai/dsh': '0.2.1-alpha.2' } });
  t.after(() => { globalThis.fetch = savedFetch; });
  const f = await dshHost(t, { manager }), before = JSON.parse((await f.call('status')).body).result.value;
  const check = JSON.parse((await f.call('update-check', { payload: { channel: 'prerelease' } })).body).result.value;
  const id = (await import('node:crypto')).randomUUID();
  const first = f.call('update-install', { payload: { profileKey: check.profileKey, candidateId: check.candidate.id, operationId: id, channel: 'prerelease' } }); await started;
  const busy = JSON.parse((await f.call('update-install', { payload: { profileKey: check.profileKey, candidateId: check.candidate.id, operationId: (await import('node:crypto')).randomUUID(), channel: 'prerelease' } })).body).result;
  assert.equal(busy.ok, false); assert.equal(busy.error.code, 'UPDATE_BUSY');
  bundle.version = version; complete({ application: 'restart-required', stage: 'install', bundle: 'dsh-cf', version });
  assert.equal(JSON.parse((await first).body).result.value.status, 'restart-required');
  assert.equal(calls.length, 1); assert.equal(calls[0].options.enabled, false); assert.equal(calls[0].options.requestId, id);
  const receipt = JSON.parse(await (await import('node:fs/promises')).readFile(join(f.dir, '.dsh-cf-updates', `${id}.json`), 'utf8'));
  assert.equal(receipt.id, id); assert.equal(receipt.result.application, 'restart-required');
  assert.equal(JSON.parse(await (await import('node:fs/promises')).readFile(join(f.dir, '.dsh-cf-updates/latest.json'), 'utf8')).id, id);
  const after = JSON.parse((await f.call('status')).body).result.value;
  for (const key of ['instanceId', 'setup', 'resources', 'autoConnect', 'gatePort', 'binary', 'steps']) assert.deepEqual(after[key], before[key]);
});
test('management authority is the peer address; Host and forwarding headers cannot grant it', () => {
  const req = (address, host, extra = {}) => ({ socket: address === undefined ? {} : { remoteAddress: address }, headers: { host, ...extra } });
  assert.equal(isManagementRequest(req('203.0.113.8', '127.0.0.1:8787')), false);
  assert.equal(isManagementRequest(req('127.0.0.1', 'dsh.example.com')), false);
  assert.equal(isManagementRequest(req('127.0.0.1', 'localhost:8787', { 'x-forwarded-host': 'evil.example.com' })), false);
  assert.equal(isManagementRequest(req(undefined, '127.0.0.1')), false);
  assert.equal(isManagementRequest(req('::ffff:127.0.0.1', 'localhost')), true);
  assert.equal(isManagementRequest(req('::1', '[::1]:8787')), true);
  assert.equal(isManagementRequest(req('203.0.113.8', 'evil.example.com@127.0.0.1')), false);
  assert.equal(isManagementRequest(req('127.0.0.1', '127.0.0.1@evil.example.com')), false);
});
test('state-changing and secret-returning actions require a management peer before the handler runs', async () => {
  const secret = 'super-secret-management-value';
  const seen = [];
  const route = rpcRoute({ requestRejection: () => undefined }, async endpoint => { seen.push(endpoint); return { ok: true, value: endpoint === 'status' ? { phase: 'idle' } : { authorizationUrl: secret } }; });
  const respond = () => ({ status: 0, body: '', headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, end(body = '') { this.body = body; }, setHeader() {} });
  const endpoints = ['oauth/start', 'oauth/finish', 'oauth/cancel', 'oauth/attempt', 'token/refresh', 'forget', 'remove', 'start', 'resume', 'mfa/enable', 'authorize', 'account', 'host/confirm', 'autoconnect', 'stop', 'cancel', 'update-status', 'update-check', 'update-install', 'nope'];
  for (const endpoint of endpoints) {
    const res = respond();
    await route.handler({
      url: `/dsh-cf/${endpoint}`, method: 'POST',
      headers: { host: 'dsh.example.com', origin: 'https://dsh.example.com', 'content-type': 'application/json' },
      socket: { remoteAddress: '203.0.113.9' },
      on() {}, once() {},
    }, res);
    assert.equal(res.status, 403, endpoint);
    assert.equal(res.body.includes(secret), false, endpoint);
  }
  assert.deepEqual(seen, []);
  const res = respond();
  const body = JSON.stringify({ type: 'client-request', rpcId: 'status-1', method: 'status', payload: {} });
  await route.handler({
    url: '/dsh-cf/status', method: 'POST',
    headers: { host: 'dsh.example.com', origin: 'https://dsh.example.com', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    on(event, fn) { if (event === 'data') fn(Buffer.from(body)); },
    once(event, fn) { if (event === 'end') fn(); },
  }, res);
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ['status']);
  assert.equal(res.body.includes(secret), false);
});
test('oauth/attempt is refused without a management peer and status omits the authorization URL', async t => {
  const sent = [];
  const route = rpcRoute({ requestRejection: () => undefined }, async () => { sent.push('handle'); return { ok: true, value: { authorizationUrl: 'http://secret.example/callback' } }; });
  const res = { status: 0, body: '', headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, end(body = '') { this.body = body; }, setHeader() {} };
  await route.handler({ url: '/dsh-cf/oauth/attempt', method: 'POST', headers: { host: '127.0.0.1:9', 'content-type': 'application/json' }, socket: { remoteAddress: '203.0.113.9' } }, res);
  assert.equal(res.status, 403);
  assert.equal(res.body.includes('secret'), false);
  assert.equal(sent.length, 0);
  const f = await dshHost(t, { config: { oauthCallbackPort: await freePort() } });
  const started = JSON.parse((await f.call('oauth/start', { payload: { clientId: 'public-client-12345', scopes: ['registered.scope'] } })).body).result;
  assert.equal(started.ok, true);
  const status = await f.call('status');
  assert.equal(status.body.includes('code_challenge'), false);
  assert.equal(status.body.includes('code_verifier'), false);
  assert.equal(status.body.includes(started.value.authorizationUrl), false);
  const attempt = JSON.parse((await f.call('oauth/attempt')).body).result.value;
  assert.equal(attempt.authorizationUrl, started.value.authorizationUrl);
  assert.equal(attempt.phase, 'waiting');
});
