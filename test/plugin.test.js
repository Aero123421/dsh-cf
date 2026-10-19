import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, access, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VERSION } from '../src/controller.js';
import { apply } from '../src/index.js';
import manifest from '../package.json' with { type: 'json' };
import { endpointOf, isManagementRequest, rpcRoute } from '../src/rpc.js';
import { listen, http } from './helpers.js';

const COOKIE = 'dsh-auth-fixture=ok';
/** Minimal DSH host: WebServer prefix routes over real loopback HTTP, and Connection's admission fence. */
async function dshHost(t, { manager, config, prepare } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cf-plugin-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await prepare?.(join(dir, '.dsh-cf'));
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
  assert.equal(body.type, 'server-response'); assert.equal(body.rpcId, 'rpc-1'); assert.equal(body.result.ok, true); assert.equal(body.result.value.status, 'unconfigured'); assert.equal(body.result.value.canManage, true);
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
  assert.equal(endpointOf('/dsh-cf/pending/resolve'), 'pending/resolve');
  for (const bad of ['/dsh-cf', '/dsh-cf/', '/dsh-cf/../x', '/dsh-cf/a//b', '/dsh-cfx/status', '/dsh-cf/a b']) assert.equal(endpointOf(bad), undefined, bad);
});
test('disposing the plugin removes its route and releases profile ownership', async t => {
  const f = await dshHost(t); await f.dispose();
  assert(!f.routes.has('/dsh-cf'));
  await assert.rejects(access(join(f.dir, '.dsh-cf', 'owner.lock')));
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
  const route = rpcRoute({ requestRejection: () => undefined }, async (endpoint, _payload, context) => { seen.push([endpoint, context.management]); return { ok: true, value: endpoint === 'status' ? { status: 'online', canManage: context.management } : { authorizationUrl: secret } }; });
  const respond = () => ({ status: 0, body: '', headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, end(body = '') { this.body = body; }, setHeader() {} });
  const endpoints = ['pending/inspect', 'pending/resolve', 'token/refresh', 'forget', 'remove', 'start', 'resume', 'pause', 'mfa/enable', 'authorize', 'account', 'host/confirm', 'autoconnect', 'cancel', 'update-install', 'oauth/start', 'nope'];
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
  const send = async (headers, remoteAddress) => {
    const res = respond(), body = JSON.stringify({ type: 'client-request', rpcId: 'status-1', method: 'status', payload: {} });
    await route.handler({ url: '/dsh-cf/status', method: 'POST', headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress }, on(event, fn) { if (event === 'data') fn(Buffer.from(body)); }, once(event, fn) { if (event === 'end') fn(); } }, res);
    return res;
  };
  const publicStatus = await send({ host: 'dsh.example.com', origin: 'https://dsh.example.com' }, '203.0.113.9');
  assert.equal(publicStatus.status, 200); assert.equal(publicStatus.body.includes(secret), false);
  const local = await send({ host: '127.0.0.1:3080' }, '127.0.0.1');
  const forwarded = await send({ host: '127.0.0.1:3080', 'x-forwarded-for': '203.0.113.9' }, '127.0.0.1');
  assert.deepEqual(seen, [['status', false], ['status', true], ['status', false]]);
  assert.equal(JSON.parse(local.body).result.value.canManage, true); assert.equal(JSON.parse(forwarded.body).result.value.canManage, false);
});
test('the status endpoint decides the full or reduced view per request, over real loopback HTTP', async t => {
  const f = await dshHost(t);
  const full = JSON.parse((await f.call('status')).body).result.value;
  assert.equal(full.canManage, true); assert.equal(full.version, manifest.version); assert.equal(full.version, VERSION); assert(full.gatePort !== undefined); assert(Array.isArray(full.progress));
  // Through the public tunnel the same route is reached with forwarding headers and a public Host.
  for (const headers of [{ 'x-forwarded-for': '198.51.100.7' }, { 'cf-connecting-ip': '198.51.100.7' }, { origin: 'https://public.example.com' }]) {
    const response = await f.call('status', { headers });
    const reduced = JSON.parse(response.body).result?.value;
    if (headers.origin) { assert.equal(response.status, 200); }
    assert.equal(reduced.canManage, false, JSON.stringify(headers));
    assert.deepEqual(Object.keys(reduced).sort(), ['autoConnect', 'canManage', 'generation', 'issue', 'lastVerifiedAt', 'paused', 'publicUrl', 'sequence', 'status', 'verified', 'version']);
  }
  const mutation = await f.call('pause', { headers: { 'x-forwarded-for': '198.51.100.7' } });
  assert.equal(mutation.status, 403);
  const accepted = JSON.parse((await f.call('pause')).body).result;
  assert.equal(accepted.ok, true);
});
test('boot auto-connect skips a paused profile and attempts an unpaused one', async t => {
  const { fingerprint } = await import('../src/store.js');
  const state = patch => async dir => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, 'state.json'), JSON.stringify({ version: 1, instanceId: '550e8400-e29b-41d4-a716-446655440000', machine: fingerprint(), autoConnect: true, proven: true, gatePort: 4567, setup: { accountId: 'a'.repeat(32), zoneId: 'b'.repeat(32), hostname: 'dsh.example.com', ownerEmail: 'owner@example.com', idpId: 'p', teamDomain: 'team.cloudflareaccess.com' }, owned: { audience: 'c'.repeat(64), appId: 'a', tunnelId: 't', dnsId: 'd' }, pending: null, lastConfigurationCheck: '2026-10-01T00:00:00Z', ...patch }));
  };
  const paused = await dshHost(t, { prepare: state({ paused: true }) });
  const pausedStatus = JSON.parse((await paused.call('status')).body).result.value;
  assert.equal(pausedStatus.status, 'paused'); assert.equal(pausedStatus.paused, true); assert.equal(pausedStatus.autoConnect, true); assert.equal(pausedStatus.hostReview, null); assert.equal(pausedStatus.issue, null);
  // No connector token was saved, so the attempt itself is visible as a SETUP failure instead of silence.
  const eligible = await dshHost(t, { prepare: state({}) });
  for (let i = 0; i < 100 && JSON.parse((await eligible.call('status')).body).result.value.issue === null; i++) await new Promise(r => setTimeout(r, 20));
  const attempted = JSON.parse((await eligible.call('status')).body).result.value;
  assert.equal(attempted.status, 'error'); assert.equal(attempted.issue.code, 'SETUP'); assert.equal(attempted.issue.retryAt, undefined);
});
test('an unusable profile state still serves the settings channel with an actionable error instead of failing activation', async t => {
  const corrupt = await dshHost(t, { prepare: async dir => { await mkdir(dir, { recursive: true, mode: 0o700 }); await writeFile(join(dir, 'state.json'), '{not-json'); } });
  const status = JSON.parse((await corrupt.call('status')).body).result.value;
  assert.equal(status.status, 'error'); assert.equal(status.issue.code, 'STATE_CORRUPT'); assert.match(status.issue.message, /state\.json/); assert.equal(status.canManage, true);
  const start = JSON.parse((await corrupt.call('start')).body).result;
  assert.equal(start.ok, false); assert.equal(start.error.code, 'STATE_CORRUPT');
  assert.equal(await readFile(join(corrupt.dir, '.dsh-cf', 'state.json'), 'utf8'), '{not-json', 'no state is written in this mode');
  await assert.rejects(access(join(corrupt.dir, '.dsh-cf', 'owner.lock')));
  // Another live DSH holds the profile.
  const live = await mkdtemp(join(tmpdir(), 'dsh-cf-live-')); t.after(() => rm(live, { recursive: true, force: true }));
  const { Store } = await import('../src/store.js'); const holder = await new Store(join(live, '.dsh-cf'), { heartbeatMs: 20 }).open(); t.after(() => holder.close());
  const locked = await dshHost(t, { config: { stateDirectory: join(live, '.dsh-cf') } });
  const lockedStatus = JSON.parse((await locked.call('status')).body).result.value;
  assert.equal(lockedStatus.status, 'error'); assert.equal(lockedStatus.issue.code, 'LOCK'); assert.equal(lockedStatus.issue.action, 'close-other-dsh');
  const reduced = JSON.parse((await locked.call('status', { headers: { 'x-forwarded-for': '198.51.100.7' } })).body).result.value;
  assert.equal(reduced.canManage, false); assert.equal(reduced.issue.code, 'LOCK');
  await locked.dispose(); assert(holder.lock, 'the other owner keeps its lock');
});
