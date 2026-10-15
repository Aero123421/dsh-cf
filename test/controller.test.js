import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../src/controller.js';
import { CfError } from '../src/common.js';
import { SETUP, AUD, HOST, fakeCloudflare, memoryStore, freePort } from './helpers.js';
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
test('stop during OAuth initiation cannot leave a callback flow or install a grant', async t => {
  const port = await freePort();
  const controller = new Controller({ store: memoryStore(), adapter: { invalidate() {} }, config: { oauthCallbackPort: port }, fetchImpl: () => { throw new Error('cancelled initiation must not fetch'); } });
  t.after(() => controller.dispose());
  const beginning = controller.handle('oauth/start', { clientId: 'test-public-client', scopes: ['test.scope'] });
  const rejected = assert.rejects(beginning);
  await controller.handle('stop'); await rejected;
  assert.equal(controller.phase, 'stopped'); assert.equal(controller.oauth.pending, null); assert.equal(controller.oauth.server, null);
  assert.equal(controller.snapshot().authorized, false);
  await assert.rejects(controller.handle('oauth/finish', { redirectUrl: `http://127.0.0.1:${port}/dsh-cf/oauth/callback?code=late&state=late` }), { code: 'OAUTH_EXPIRED' });
});
test('temporary disconnection can recover, but fatal connector events close runtime and remain errors', async t => {
  const f = await fixture(t); await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  for (const kind of ['owner', 'http', 'api', 'websocket']) f.gate.onEvidence(kind);
  assert.equal(f.controller.phase, 'ready');
  f.connector.status('disconnected'); assert.equal(f.controller.phase, 'reconnecting');
  assert.equal(f.controller.evidence.http, false); assert.equal(f.controller.evidence.websocket, false);
  f.connector.status('connected'); assert.equal(f.controller.phase, 'rechecking'); assert.notEqual(f.controller.phase, 'ready');
  for (const kind of ['http', 'api', 'websocket']) f.gate.onEvidence(kind);
  assert.equal(f.controller.phase, 'ready');
  const connector = f.connector, gate = f.gate;
  connector.status('error'); connector.status('stopped'); connector.status('connected');
  await new Promise(r => setImmediate(r));
  assert.equal(f.controller.phase, 'error'); assert.equal(f.controller.error.code, 'CONNECTOR_EXIT');
  assert.equal(f.controller.snapshot().steps.find(s => s.id === 'tunnel').status, 'error'); assert(gate.closed); assert(connector.stopped);
  await f.controller.handle('resume'); await f.controller.operation.promise;
  assert.equal(f.controller.phase, 'waiting-browser'); assert.equal(f.controller.error, null);
});
test('fatal connector exit during external verification cannot be overwritten by startup', async t => {
  const f = await fixture(t); let release, probing = false;
  f.controller.negativeProbe = async () => { probing = true; await new Promise(r => { release = r; }); };
  await f.controller.handle('start', SETUP); const operation = f.controller.operation.promise;
  for (let i = 0; !probing && i < 100; i++) await new Promise(r => setTimeout(r, 10));
  assert(probing); const gate = f.gate, connector = f.connector;
  connector.status('error'); connector.status('stopped'); release(); await operation;
  assert.equal(f.controller.phase, 'error'); assert.equal(f.controller.error.code, 'CONNECTOR_EXIT'); assert(gate.closed); assert(connector.stopped);
});
test('losing profile ownership stops only the owned runtime and reports a lock error', async t => {
  const f = await fixture(t); await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  const gate = f.gate, connector = f.connector;
  await f.store.onOwnershipLost();
  assert.equal(f.controller.phase, 'error'); assert.equal(f.controller.error.code, 'LOCK'); assert(gate.closed); assert(connector.stopped);
  assert.equal(f.store.state.owned.tunnelId, 'tunnel');
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

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const oauthPayload = { clientId: 'test-public-client', scopes: ['test.scope'] };
const oauthCallback = flow => `${flow.redirectUri}?code=fixture&state=${new URL(flow.authorizationUrl).searchParams.get('state')}`;

test('concurrent stop and dispose share shutdown and retain ownership until the connector exits', async t => {
  const f = await fixture(t); await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  const entered = deferred(), release = deferred(); let stops = 0;
  f.connector.stop = async () => { stops++; entered.resolve(); await release.promise; };
  const stopping = f.controller.handle('stop'); await entered.promise;
  assert.equal(f.controller.snapshot().busy, true);
  await assert.rejects(f.controller.handle('resume'), { code: 'BUSY' });
  await assert.rejects(f.controller.handle('authorize', { token: 'new-management-token-123456' }), { code: 'BUSY' });
  let disposed = false;
  const disposing = f.controller.dispose().then(() => { disposed = true; });
  await tick(); assert.equal(disposed, false); assert.equal(f.store.closed, false); assert.equal(stops, 1);
  release.resolve(); await Promise.all([stopping, disposing]);
  assert.equal(stops, 1); assert.equal(f.store.closed, true); assert.equal(f.controller.phase, 'stopped');
});
test('dispose waits for cleanup already started by a fatal connector event', async t => {
  const f = await fixture(t); await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  const entered = deferred(), release = deferred();
  f.connector.stop = async () => { entered.resolve(); await release.promise; };
  f.connector.status('error'); await entered.promise;
  const disposing = f.controller.dispose(); await tick(); assert.equal(f.store.closed, false);
  release.resolve(); await disposing; assert.equal(f.store.closed, true);
});
test('API authorization supersedes an older OAuth exchange before its token arrives', async t => {
  const api = fakeCloudflare(), entered = deferred(), release = deferred();
  const controller = new Controller({ store: memoryStore(), adapter: { invalidate() {} }, config: { oauthCallbackPort: await freePort() }, fetchImpl: async (url, options) => {
    if (String(url).endsWith('/oauth2/token')) { entered.resolve(); await release.promise; return Response.json({ access_token: 'old-oauth-management-token-123', token_type: 'Bearer', expires_in: 300 }); }
    return api.fetchImpl(url, options);
  } });
  t.after(() => controller.dispose());
  const flow = await controller.handle('oauth/start', oauthPayload);
  const old = assert.rejects(controller.handle('oauth/finish', { redirectUrl: oauthCallback(flow) })); await entered.promise;
  await controller.handle('authorize', { token: 'new-api-management-token-123' });
  release.resolve(); await old;
  assert.equal(controller.token, 'new-api-management-token-123'); assert.equal(controller.grantType, 'api'); assert.equal(controller.oauth.pending, null);
});
test('starting OAuth supersedes an API authorization already waiting for accounts', async t => {
  const api = fakeCloudflare(), entered = deferred(), release = deferred(); let hold = true;
  const controller = new Controller({ store: memoryStore(), adapter: { invalidate() {} }, config: { oauthCallbackPort: await freePort() }, fetchImpl: async (url, options) => {
    if (hold) { hold = false; entered.resolve(); await release.promise; }
    if (String(url).endsWith('/oauth2/token')) return Response.json({ access_token: 'new-oauth-management-token-123', token_type: 'Bearer', expires_in: 300 });
    return api.fetchImpl(url, options);
  } });
  t.after(() => controller.dispose());
  const old = assert.rejects(controller.handle('authorize', { token: 'old-api-management-token-123' })); await entered.promise;
  const flow = await controller.handle('oauth/start', oauthPayload);
  release.resolve(); await old; assert.equal(controller.token, null);
  await controller.handle('oauth/finish', { redirectUrl: oauthCallback(flow) });
  assert.equal(controller.token, 'new-oauth-management-token-123'); assert.equal(controller.grantType, 'oauth');
});
for (const endpoint of ['stop', 'forget']) test(`${endpoint} aborts and drains an MFA change before a new PUT can be sent`, async t => {
  const api = fakeCloudflare(), entered = deferred(), release = deferred(); let hold = false, requestSignal;
  const controller = new Controller({ store: memoryStore(), adapter: { invalidate() {} }, fetchImpl: async (url, options) => {
    options.signal.throwIfAborted(); // The native fetch boundary refuses an already aborted request.
    if (hold && String(url).endsWith('/access/organizations') && options.method === 'GET') {
      hold = false; requestSignal = options.signal; entered.resolve(); await release.promise;
    }
    return api.fetchImpl(url, options);
  } });
  t.after(() => controller.dispose());
  await controller.handle('authorize', { token: 'management-token-fixture-123' });
  const account = await controller.handle('account', { accountId: SETUP.accountId }); hold = true;
  const changing = assert.rejects(controller.handle('mfa/enable', { accountId: SETUP.accountId, revision: account.organizationRevision, approved: true }));
  await entered.promise; assert.equal(controller.snapshot().busy, true);
  let finished = false; const cancelling = controller.handle(endpoint).then(() => { finished = true; });
  await tick(); assert.equal(requestSignal.aborted, true); assert.equal(finished, false);
  release.resolve(); await Promise.all([changing, cancelling]);
  assert.equal(api.data.writes.length, 0);
  if (endpoint === 'forget') { assert.equal(controller.accountDetails, null); assert.equal(controller.token, null); }
});
test('forget prevents a late account response from restoring account state', async t => {
  const api = fakeCloudflare(), entered = deferred(), release = deferred(); let hold = false;
  const controller = new Controller({ store: memoryStore(), adapter: { invalidate() {} }, fetchImpl: async (url, options) => {
    if (hold && String(url).endsWith('/access/organizations')) { entered.resolve(); await release.promise; }
    return api.fetchImpl(url, options); // Deliberately complete after abort to exercise the commit guard.
  } });
  t.after(() => controller.dispose()); await controller.handle('authorize', { token: 'management-token-fixture-123' }); hold = true;
  const reading = assert.rejects(controller.handle('account', { accountId: SETUP.accountId })); await entered.promise;
  const forgetting = controller.handle('forget'); release.resolve(); await Promise.all([reading, forgetting]);
  assert.equal(controller.accountDetails, null); assert.equal(controller.accountList.length, 0); assert.equal(controller.token, null);
});
test('stop drains revocation and forget cannot erase a subsequently admitted grant', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); f.controller.grantType = 'oauth';
  let signal;
  f.controller.oauth.revoke = async (_token, abortSignal) => { signal = abortSignal; entered.resolve(); await release.promise; abortSignal.throwIfAborted(); };
  const forgetting = assert.rejects(f.controller.handle('forget', { revoke: true })); await entered.promise;
  await assert.rejects(f.controller.handle('authorize', { token: 'new-management-token-123456' }), { code: 'BUSY' });
  let stopped = false; const stopping = f.controller.handle('stop').then(() => { stopped = true; });
  await tick(); assert.equal(signal.aborted, true); assert.equal(stopped, false);
  release.resolve(); await Promise.all([forgetting, stopping]);
  await f.controller.handle('authorize', { token: 'new-management-token-123456' });
  assert.equal(f.controller.token, 'new-management-token-123456');
});
test('failed configuration read-back invalidates resume even when prior resource IDs and token remain', async t => {
  const f = await fixture(t); await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  assert(f.store.state.lastConfigurationCheck);
  f.controller.deps.provision = async () => { throw new CfError('DNS_CHANGED', 'Read-back did not match'); };
  await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  assert.equal(f.store.state.lastConfigurationCheck, null); assert(f.store.state.owned.dnsId); assert(await f.store.hasToken());
  await f.controller.handle('resume'); await f.controller.operation.promise;
  assert.equal(f.controller.phase, 'error'); assert.equal(f.controller.error.code, 'SETUP'); assert.equal(f.controller.connector, null);
});
test('forget revokes with the captured client identity after clearing the local grant', async t => {
  const f = await fixture(t); f.controller.grantType = 'oauth'; f.controller.oauth.grantClientId = 'fixture-client-id';
  let form;
  f.controller.oauth.fetch = async (_url, options) => { assert.equal(f.controller.token, null); form = options.body; return new Response(null); };
  await f.controller.handle('forget', { revoke: true });
  assert.equal(form.get('client_id'), 'fixture-client-id'); assert.equal(form.get('token'), 'management-secret-test-123456');
  assert.equal(f.controller.oauth.grantClientId, null);
});
test('a loopback OAuth callback cannot replace credentials during provisioning', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { ensureBinary: async () => { entered.resolve(); await release.promise; return { path: '/fixture', source: 'fixture', version: 'fixture' }; } });
  f.controller.config.oauthCallbackPort = await freePort();
  f.controller.oauth.fetch = async () => Response.json({ access_token: 'late-oauth-management-token-123', token_type: 'Bearer', expires_in: 300 });
  const flow = await f.controller.handle('oauth/start', oauthPayload);
  await f.controller.handle('start', SETUP); const operation = f.controller.operation.promise; await entered.promise;
  // The HTTP listener calls OAuth.finish directly, outside the controller's RPC admission check.
  await assert.rejects(f.controller.oauth.finish(oauthCallback(flow)), { code: 'BUSY' });
  assert.equal(f.controller.token, 'management-secret-test-123456');
  release.resolve(); await operation; assert.equal(f.controller.phase, 'waiting-browser');
});

test('oauth phases stay on the host and status never carries the authorization URL or PKCE', async t => {
  const port = await freePort();
  const api = fakeCloudflare();
  const controller = new Controller({ store: memoryStore(), adapter: { invalidate() {} }, config: { oauthCallbackPort: port }, fetchImpl: async (url, options) => {
    if (String(url).endsWith('/oauth2/token')) return new Response('no', { status: 400 });
    return api.fetchImpl(url, options);
  } });
  t.after(() => controller.dispose());
  const flow = await controller.handle('oauth/start', oauthPayload);
  const snap = JSON.stringify(controller.snapshot());
  assert.equal(controller.snapshot().oauth.phase, 'waiting');
  assert.equal(snap.includes('code_challenge'), false);
  assert.equal(snap.includes('code_verifier'), false);
  assert.equal(snap.includes(flow.authorizationUrl), false);
  assert.equal((await controller.handle('oauth/attempt')).authorizationUrl, flow.authorizationUrl);
  controller.noteOauth('error', { attempt: flow.attempt - 1, failure: 'OAUTH_EXCHANGE' });
  assert.equal(controller.snapshot().oauth.phase, 'waiting');
  const state = new URL(flow.authorizationUrl).searchParams.get('state');
  await assert.rejects(controller.handle('oauth/finish', { redirectUrl: `${flow.redirectUri}?error=access_denied&state=${state}` }), { code: 'OAUTH_DENIED' });
  assert.equal(controller.snapshot().oauth.phase, 'denied');
  assert.equal(controller.snapshot().oauth.failure, 'OAUTH_DENIED');
  assert.equal((await controller.handle('oauth/attempt')).authorizationUrl, null);
  const again = await controller.handle('oauth/start', oauthPayload);
  await assert.rejects(controller.handle('oauth/finish', { redirectUrl: oauthCallback(again) }), { code: 'OAUTH_EXCHANGE' });
  assert.equal(controller.snapshot().oauth.phase, 'error');
  assert.equal(controller.snapshot().oauth.failure, 'OAUTH_EXCHANGE');
  assert.equal(JSON.stringify(controller.snapshot()).includes(again.authorizationUrl), false);
});
test('a 5xx before a channel succeeds is not stored as evidence', async t => {
  const f = await fixture(t); await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  assert.equal(f.controller.phase, 'waiting-browser');
  f.gate.onFault({ status: 'upstream-failed', channel: 'http', httpStatus: 503 });
  assert.equal(f.controller.phase, 'degraded');
  assert.equal(f.controller.error.code, 'DSH_UPSTREAM');
  assert.equal(f.controller.evidence.http, false);
  assert.notEqual(f.store.state.proven, true);
});
test('an upstream failure is not success, and reconnect does not restore ready without new DSH traffic', async t => {
  const f = await fixture(t); await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  for (const kind of ['owner', 'http', 'api', 'websocket']) f.gate.onEvidence(kind);
  assert.equal(f.controller.phase, 'ready');
  const verified = f.store.state.lastVerifiedAt;
  assert.equal(typeof verified, 'string');
  f.gate.onFault({ status: 'upstream-failed', channel: 'http', httpStatus: 503 });
  assert.equal(f.controller.phase, 'ready');
  assert.equal(f.controller.evidence.http, true);
  assert.equal(f.controller.error, null);
  assert.equal(f.store.state.proven, true);
  assert.equal(f.store.state.lastVerifiedAt, verified);
  f.gate.onFault({ status: 'upstream-failed', channel: 'http' });
  assert.equal(f.controller.phase, 'degraded');
  assert.equal(f.controller.error.code, 'DSH_UPSTREAM');
  assert.equal(f.controller.evidence.http, false);
  assert.equal(f.controller.evidence.api, true);
  f.gate.onFault({ status: 'auth-rejected', channel: 'api' });
  assert.equal(f.controller.phase, 'degraded');
  assert.equal(f.controller.error.code, 'DSH_AUTH');
  f.connector.status('disconnected');
  f.connector.status('connected');
  assert.equal(f.controller.phase, 'rechecking');
  assert.notEqual(f.controller.phase, 'ready');
  await f.controller.handle('stop');
  assert.equal(f.controller.phase, 'stopped');
  assert.equal(f.store.state.lastVerifiedAt, verified);
  assert.equal(f.store.state.proven, true);
  assert.equal(f.controller.snapshot().evidence.http, undefined);
  assert(f.controller.snapshot().steps.every(step => step.status === 'idle'));
});
test('a closed WebSocket asks for another check and silence does not change that state', async t => {
  const f = await fixture(t); await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  for (const kind of ['owner', 'http', 'api', 'websocket']) f.gate.onEvidence(kind);
  f.gate.onFault({ status: 'websocket-closed', channel: 'websocket' });
  assert.equal(f.controller.phase, 'rechecking');
  assert.equal(f.controller.error, null);
  assert.equal(f.connector.stopped, undefined);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.controller.phase, 'rechecking');
});
test('token refresh restarts only the connector, and a failed refetch keeps the saved token', async t => {
  let refreshes = 0;
  const f = await fixture(t, { refreshTunnelToken: async (_cf, store) => {
    refreshes++;
    if (refreshes > 1) throw new CfError('CF_NETWORK', 'Cloudflare did not respond.');
    store.token = 'refreshed-connector-token-123456789';
  } });
  await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  const first = f.connector;
  first.stop = async () => { first.stopped = true; first.status('stopped'); };
  await f.controller.handle('token/refresh'); await f.controller.operation.promise;
  assert.equal(refreshes, 1);
  assert.equal(first.stopped, true);
  assert.notEqual(f.connector, first);
  assert.equal(f.controller.phase, 'rechecking');
  assert.equal(f.controller.gate.closed, undefined);
  assert.equal(f.store.state.owned.tunnelId, 'tunnel');
  const saved = f.store.token;
  const current = f.connector;
  await f.controller.handle('token/refresh'); await f.controller.operation.promise;
  assert.equal(refreshes, 2);
  assert.equal(f.controller.phase, 'rechecking');
  assert.equal(f.controller.error.code, 'CF_NETWORK');
  assert.equal(f.controller.gate.closed, undefined);
  assert.equal(f.connector, current);
  assert.equal(current.stopped, undefined);
  assert.equal(f.store.token, saved);
  assert.equal(JSON.stringify(f.controller.snapshot()).includes(saved), false);
});
test('token refresh does not report success when the profile cannot reconnect', async t => {
  const f = await fixture(t, { refreshTunnelToken: async () => {} });
  await f.controller.handle('token/refresh'); await f.controller.operation.promise;
  assert.equal(f.controller.phase, 'error');
  assert.equal(f.controller.error.code, 'SETUP');
  assert.equal(f.controller.gate, null);
  assert.equal(f.controller.connector, null);
  assert.equal(JSON.stringify(f.controller.snapshot()).includes('management-secret'), false);
});
test('cancel during token refresh does not write a replacement token', async t => {
  const entered = deferred(); let writes = 0;
  const f = await fixture(t, { refreshTunnelToken: async (_cf, _store, signal) => {
    entered.resolve();
    await new Promise((_resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    writes++;
  } });
  await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  const before = f.store.token;
  await f.controller.handle('token/refresh'); await entered.promise;
  await f.controller.handle('cancel');
  assert.equal(writes, 0);
  assert.equal(f.store.token, before);
  assert.equal(f.controller.phase, 'stopped');
});
test('reconnect with a saved connector token does not require a management grant', async t => {
  const f = await fixture(t); await f.controller.handle('start', SETUP); await f.controller.operation.promise;
  f.controller.token = null; f.controller.tokenUntil = 0;
  await f.controller.handle('resume'); await f.controller.operation.promise;
  assert.equal(f.controller.phase, 'waiting-browser');
  assert.equal(f.controller.snapshot().authorized, false);
});
test('stop aborts authorization and a late account list does not restore the grant', async t => {
  const api = fakeCloudflare(), entered = deferred(), release = deferred(); let hold = false;
  const controller = new Controller({ store: memoryStore(), adapter: { invalidate() {} }, fetchImpl: async (url, options) => {
    if (hold && String(url).includes('/accounts?')) { entered.resolve(); await release.promise; options.signal.throwIfAborted(); }
    return api.fetchImpl(url, options);
  } });
  t.after(() => controller.dispose());
  hold = true;
  const reading = assert.rejects(controller.handle('authorize', { token: 'late-management-token-123456' }));
  await entered.promise;
  const stopping = controller.handle('stop');
  await tick();
  release.resolve();
  await Promise.all([reading, stopping]);
  assert.equal(controller.token, null);
  assert.equal(controller.snapshot().authorized, false);
  assert.equal(controller.accountList.length, 0);
});
test('stop keeps an OAuth denial, expiry, or exchange failure', async t => {
  const controller = new Controller({ store: memoryStore(), adapter: { invalidate() {} } });
  t.after(() => controller.dispose());
  controller.noteOauth('denied', { attempt: 1, failure: 'OAUTH_DENIED' });
  await controller.stop();
  assert.equal(controller.phase, 'stopped');
  assert.equal(controller.snapshot().oauth.phase, 'denied');
  assert.equal(controller.snapshot().oauth.failure, 'OAUTH_DENIED');
  controller.noteOauth('error', { attempt: 2, failure: 'OAUTH_EXCHANGE' });
  await controller.stop();
  assert.equal(controller.snapshot().oauth.phase, 'error');
  assert.equal(controller.snapshot().oauth.failure, 'OAUTH_EXCHANGE');
  let release;
  controller.operation = { abort: new AbortController(), promise: new Promise(resolve => { release = resolve; }) };
  controller.noteOauth('waiting', { attempt: 3, expiresAt: Date.now() + 60_000 });
  const stopping = controller.stop();
  assert.equal(controller.snapshot().oauth.phase, 'cancelled');
  controller.noteOauth('expired', { attempt: 3, failure: 'OAUTH_EXPIRED' });
  release();
  await stopping;
  assert.equal(controller.phase, 'stopped');
  assert.equal(controller.snapshot().oauth.phase, 'expired');
  assert.equal(controller.snapshot().oauth.failure, 'OAUTH_EXPIRED');
});
