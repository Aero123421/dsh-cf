import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../src/controller.js';
import { CfError } from '../src/common.js';
import { SETUP, AUD, HOST, fakeCloudflare, memoryStore } from './helpers.js';
async function fixture(t, overrides = {}) {
  const store = memoryStore(), api = fakeCloudflare(); let gate, connector;
  const dependencies = {
    ensureBinary: async () => ({ path: '/fixture/cloudflared', version: 'fixture', source: 'installed' }),
    accessVerifier: async () => () => ({}),
    Gate: class { constructor(options) { Object.assign(this, options); this.proofNonce = 'test-nonce'; this.host = options.host; gate = this; } async start() { return 4567; } async close() { this.closed = true; } },
    Connector: class { constructor(status) { this.status = status; connector = this; } async start() { this.status('connected'); } async stop() { this.stopped = true; } },
    provision: async (_cf, store, setup) => { store.state.setup = setup; store.state.owned = { audience: AUD, appId: 'app', tunnelId: 'tunnel', dnsId: 'dns' }; await store.writeToken('fixture-dedicated-token-123'); },
    ...overrides,
  };
  const fetchImpl = (url, options) => String(url).startsWith('https://dsh.example.com/') ? Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' } })) : api.fetchImpl(url, options);
  const controller = new Controller({ store, adapter: { facts() {}, async trust() {}, invalidate() {} }, fetchImpl, dependencies });
  t.after(() => controller.dispose()); await controller.authorized('management-secret-test-123456', Date.now() + 60000, 'api');
  return { controller, store, get gate() { return gate; }, get connector() { return connector; } };
}
test('spawn/registration alone is never marked Ready; each real evidence class is required', async t => {
  const f = await fixture(t); await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  assert.equal(f.controller.phase, 'waiting-browser'); assert.notEqual(f.store.state.proven, true);
  for (const kind of ['owner', 'http', 'api']) f.gate.onEvidence(kind);
  assert.notEqual(f.controller.phase, 'ready'); f.gate.onEvidence('websocket'); assert.equal(f.controller.phase, 'ready'); assert.equal(f.store.state.proven, true);
});
test('status allowlist never returns API tokens or dedicated connector credentials', async t => {
  const f = await fixture(t); await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  const raw = JSON.stringify(f.controller.snapshot()); assert(!raw.includes('management-secret')); assert(!raw.includes('fixture-dedicated-token'));
});
test('concurrent setup is rejected and cancel waits for the owned operation', async t => {
  const f = await fixture(t, { ensureBinary: ({ signal }) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  await f.controller.handle('start', SETUP);
  await assert.rejects(f.controller.handle('start', SETUP), { code: 'BUSY' });
  await new Promise(r => setTimeout(r, 20)); await f.controller.handle('cancel'); assert.equal(f.controller.phase, 'stopped'); assert.equal(f.controller.operation, null);
});
test('negative probe rejects a success/login HTML page rather than accepting HTTP 200', async t => {
  const f = await fixture(t); f.controller.fetch = async () => new Response('<html>login</html>', { status: 200 });
  await assert.rejects(f.controller.negativeProbe(SETUP, new AbortController().signal), { code: 'UNPROTECTED' });
});
test('stopping closes the gate and connector without deleting Cloudflare resources', async t => {
  const f = await fixture(t); await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  const gate = f.gate, connector = f.connector; await f.controller.handle('stop');
  assert(gate.closed); assert(connector.stopped); assert.equal(f.store.state.owned.tunnelId, 'tunnel');
});
test('auto-connect cannot be enabled until browser and real transport verification completes', async t => {
  const f = await fixture(t); await assert.rejects(f.controller.handle('autoconnect', { enabled: true }), { code: 'VERIFY_FIRST' });
});
test('shared MFA mutation requires explicit consent', async t => {
  const f = await fixture(t); await assert.rejects(f.controller.handle('mfa/enable', { accountId: SETUP.accountId }), { code: 'CONSENT' });
});
test('a host identity review blocks connect, resume and auto-connect until confirmed locally', async t => {
  const f = await fixture(t); f.store.state.hostReview = { at: '2026-10-13T00:00:00.000Z' }; f.store.state.proven = true;
  assert.deepEqual(f.controller.snapshot().hostReview, { at: '2026-10-13T00:00:00.000Z' });
  for (const [endpoint, payload] of [['start', SETUP], ['resume', {}], ['autoconnect', { enabled: true }]]) await assert.rejects(f.controller.handle(endpoint, payload), { code: 'HOST_REVIEW' });
  assert.equal(f.controller.operation, null);
  await assert.rejects(f.controller.handle('host/confirm', {}), { code: 'CONSENT' });
  await f.controller.handle('host/confirm', { approved: true }); assert.equal(f.controller.snapshot().hostReview, null);
  await f.controller.handle('start', SETUP); await f.controller.operation.promise; assert.equal(f.controller.phase, 'waiting-browser');
});
test('setup waits for DSH to open its Web listener instead of failing at boot', async t => {
  const f = await fixture(t); let calls = 0;
  f.controller.adapter.facts = () => { if (++calls < 4) { const e = new CfError('DSH_PORT', 'not yet'); throw e; } return {}; };
  await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  assert.equal(f.controller.phase, 'waiting-browser'); assert(calls >= 4);
});
test('a wrong DSH bind address still fails immediately', async t => {
  const f = await fixture(t); f.controller.adapter.facts = () => { throw new CfError('DSH_BIND', 'public bind'); };
  await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  assert.equal(f.controller.phase, 'error'); assert.equal(f.controller.error.code, 'DSH_BIND');
});
test('forgetting always clears the local grant even when remote revocation fails', async t => {
  const f = await fixture(t); f.controller.grantType = 'oauth';
  f.controller.oauth.revoke = async () => { throw new CfError('OAUTH_REVOKE', 'not confirmed'); };
  await assert.rejects(f.controller.handle('forget', { revoke: true }), { code: 'OAUTH_REVOKE' });
  assert.equal(f.controller.token, null); assert.equal(f.controller.snapshot().authorized, false);
});
test('dispose releases profile ownership even if stopping the runtime throws', async t => {
  const f = await fixture(t); await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  f.gate.close = async () => { throw new Error('close failed'); };
  await assert.rejects(f.controller.dispose()); assert.equal(f.store.closed, true);
});
test('resource deletion requires exact typed hostname confirmation', async t => {
  const f = await fixture(t); f.store.state.setup = SETUP;
  await assert.rejects(f.controller.handle('remove', { confirmHostname: 'other.example.com' }), { code: 'CONFIRM_DELETE' });
});
