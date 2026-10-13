import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index.js';
import { endpointOf } from '../src/rpc.js';
import { listen, http } from './helpers.js';

const COOKIE = 'dsh-auth-fixture=ok';
/** Minimal DSH host: WebServer prefix routes over real loopback HTTP, and Connection's admission fence. */
async function dshHost(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cf-plugin-')); t.after(() => rm(dir, { recursive: true, force: true }));
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
    profileContext: { dir },
    effect(fn) { const dispose = fn(); disposers.push(dispose); return dispose; },
    inject(_deps, callback) { callback({ connection, webServer, effect: ctx.effect }); },
    get: name => ({ connection, webServer })[name],
  };
  await apply(ctx, { stateDirectory: join(dir, '.dsh-cf') });
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
