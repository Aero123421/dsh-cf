import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { Controller, UnavailableController } from '../src/controller.js';
import { Gate } from '../src/gate.js';
import { CfError } from '../src/common.js';
import { SETUP, AUD, HOST, fakeCloudflare, memoryStore, listen } from './helpers.js';

const TOKEN = 'management-secret-test-123456';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check, message = 'condition did not complete') {
  for (let i = 0; !check() && i < 300; i++) await new Promise(r => setTimeout(r, 10));
  assert(check(), message);
}
/** A controller with fake cloudflared, gate, Cloudflare API and DSH. Every runtime event lands in `log`. */
async function fixture(t, { overrides = {}, adapter = {}, authorize = true, state, ...options } = {}) {
  const store = memoryStore(), api = fakeCloudflare(), log = [], busyPorts = new Set(), mode = { connector: 'connect' };
  if (state) Object.assign(store.state, state);
  let gate, connector; const gates = [], connectors = [];
  const dependencies = {
    ensureBinary: async () => ({ path: '/fixture/cloudflared', version: 'fixture', source: 'installed' }),
    accessVerifier: async () => () => ({}),
    Gate: class {
      constructor(o) { Object.assign(this, o); gate = this; gates.push(this); }
      async start(port) { if (busyPorts.has(port)) throw Object.assign(new Error('in use'), { code: 'EADDRINUSE' }); this.port = port || 4567; return this.port; }
      async close() { log.push('gate.close'); this.closed = true; }
    },
    Connector: class {
      constructor(status) { this.status = status; connector = this; connectors.push(this); }
      async start() { if (mode.connector === 'fail') throw new Error('spawn failed'); if (mode.connector === 'connect') this.status('connected'); }
      async stop() { log.push('connector.stop'); this.stopped = true; }
    },
    provision: async (_cf, store, setup, port) => { store.state.setup = setup; store.state.gatePort = port; store.state.owned = { audience: AUD, appId: 'app', tunnelId: 'tunnel', dnsId: 'dns' }; await store.writeToken('fixture-dedicated-token-123'); },
    ...overrides,
  };
  const fetchImpl = (url, options) => String(url).startsWith('https://dsh.example.com/') ? Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' } })) : api.fetchImpl(url, options);
  const controller = new Controller({ store, adapter: { facts() {}, async trust() { return { added: null }; }, async untrust() { return 'reverted'; }, invalidate() {}, ...adapter }, fetchImpl, dependencies, retryDelaysMs: [15, 25, 35], retryCapMs: 45, ...options });
  t.after(() => controller.dispose());
  if (authorize) await controller.authorize(TOKEN);
  const act = (endpoint, payload = {}) => controller.handle(endpoint, payload, { management: true });
  const settle = async () => { await controller.operation?.promise; };
  const evidence = () => { for (const kind of ['owner', 'http', 'api', 'websocket']) gate.onEvidence(kind); };
  return { controller, store, api, log, busyPorts, mode, act, settle, evidence, get gate() { return gate; }, get connector() { return connector; }, gates, connectors };
}
const connect = async f => { await f.act('start', SETUP); await f.settle(); };
/** A profile that a previous run provisioned and verified. */
const savedState = () => ({ setup: { ...SETUP }, owned: { audience: AUD, appId: 'app', tunnelId: 'tunnel', dnsId: 'dns' }, lastConfigurationCheck: '2026-10-01T00:00:00.000Z', proven: true, autoConnect: true, gatePort: 4567 });
const withToken = async f => f.store.writeToken('fixture-dedicated-token-123');

test('the status is online once the gate listens and the connector is connected, before any browser traffic', async t => {
  const f = await fixture(t); await connect(f);
  const s = f.controller.snapshot(true);
  assert.equal(s.status, 'online'); assert.equal(s.issue, null); assert.equal(s.verified, false); assert.equal(s.lastVerifiedAt, null);
  assert.deepEqual(s.evidence, { unauthenticatedRejected: true, owner: false, http: false, api: false, websocket: false });
  assert.equal(s.operation, null); assert.equal(s.busy, false);
});

test('verified and lastVerifiedAt come only from observed owner, HTTP, API and WebSocket traffic', async t => {
  const f = await fixture(t); await connect(f);
  for (const kind of ['owner', 'http', 'api']) f.gate.onEvidence(kind);
  assert.equal(f.controller.snapshot(true).verified, false); assert.notEqual(f.store.state.proven, true);
  f.gate.onEvidence('websocket');
  const s = f.controller.snapshot(true);
  assert.equal(s.verified, true); assert.equal(typeof s.lastVerifiedAt, 'string'); assert.equal(f.store.state.proven, true);
  assert.equal(s.status, 'online');
  assert(s.progress.every(step => step.status === 'done'), JSON.stringify(s.progress));
});

test('a closed tab, an ended WebSocket or a lost browser never changes the status or raises an issue', async t => {
  const f = await fixture(t); await connect(f); f.evidence();
  const verified = f.store.state.lastVerifiedAt, sequence = f.controller.seq;
  f.gate.onFault({ status: 'websocket-closed', channel: 'websocket' });
  f.gate.onFault({ status: 'something-new', channel: 'http' });
  const s = f.controller.snapshot(true);
  assert.equal(s.status, 'online'); assert.equal(s.issue, null); assert.equal(s.evidence.websocket, true); assert.equal(s.lastVerifiedAt, verified);
  assert.equal(f.controller.seq, sequence, 'nothing to report');
});

test('a DSH upstream failure keeps the status online with a warning that the next good request clears', async t => {
  const f = await fixture(t); await connect(f); f.evidence();
  f.gate.onFault({ status: 'upstream-failed', channel: 'api', httpStatus: 503 });
  let s = f.controller.snapshot(true);
  assert.equal(s.status, 'online'); assert.equal(s.issue.code, 'DSH_UPSTREAM'); assert.equal(s.issue.retryAt, undefined); assert.equal(s.verified, true); assert.equal(s.evidence.api, true);
  f.gate.onHealthy(); assert.equal(f.controller.snapshot(true).issue, null);
  f.gate.onFault({ status: 'auth-rejected', channel: 'api' });
  s = f.controller.snapshot(true);
  assert.equal(s.status, 'online'); assert.equal(s.issue.code, 'DSH_AUTH'); assert.doesNotMatch(s.issue.message, /sign in again|local settings/i);
  assert.match(s.issue.message, /fresh|automatically|reload/i);
  f.gate.onFault({ status: 'verification-unavailable', channel: 'http' });
  assert.equal(f.controller.snapshot(true).issue.code, 'ACCESS_KEYS');
  f.gate.onHealthy(); assert.equal(f.controller.snapshot(true).issue, null);
});

test('a 5xx before any success is not stored as evidence, and a disconnected connector is reconnecting without claiming it reconnected', async t => {
  const f = await fixture(t); await connect(f);
  f.gate.onFault({ status: 'upstream-failed', channel: 'http', httpStatus: 503 });
  assert.equal(f.controller.evidence.http, undefined); assert.notEqual(f.store.state.proven, true);
  f.gate.onHealthy();
  f.connector.status('disconnected');
  let s = f.controller.snapshot(true);
  assert.equal(s.status, 'reconnecting'); assert.equal(s.issue.code, 'TUNNEL_DISCONNECTED'); assert.equal(s.connector.status, 'disconnected'); assert.doesNotMatch(s.issue.message, /reconnected/);
  f.connector.status('connected');
  s = f.controller.snapshot(true); assert.equal(s.status, 'online'); assert.equal(s.issue, null);
  assert.equal(f.connector.stopped, undefined); assert.equal(f.gate.closed, undefined);
});

test('the public view has a fixed small shape and the management view the full contract', async t => {
  const f = await fixture(t); await connect(f); f.evidence();
  const open = f.controller.snapshot(false);
  assert.deepEqual(Object.keys(open).sort(), ['autoConnect', 'canManage', 'generation', 'issue', 'lastVerifiedAt', 'paused', 'publicUrl', 'sequence', 'status', 'verified', 'version']);
  assert.equal(open.canManage, false); assert.equal(open.status, 'online'); assert.equal(open.publicUrl, `https://${HOST}/`); assert.equal(open.verified, true);
  const text = JSON.stringify(open);
  for (const secret of ['team.cloudflareaccess', 'owner@example.com', 'provider-1', 'tunnel', AUD, '/fixture/cloudflared', 'management-secret', '4567', 'a'.repeat(32)]) assert(!text.includes(secret), secret);
  const full = f.controller.snapshot(true);
  assert.deepEqual(Object.keys(full).sort(), ['account', 'accounts', 'authorization', 'autoConnect', 'busy', 'canManage', 'connector', 'enrollmentUrl', 'evidence', 'gatePort', 'generation', 'hostReview', 'issue', 'labels', 'lastConfigurationCheck', 'lastVerifiedAt', 'operation', 'paused', 'pendingWrite', 'progress', 'publicUrl', 'resources', 'sequence', 'setup', 'status', 'trustedHostLeft', 'verified', 'version'].sort());
  assert.equal(full.canManage, true); assert.deepEqual(full.progress.map(step => step.id), ['environment', 'authorization', 'access', 'tunnel', 'browser', 'dsh']);
  assert.deepEqual(Object.keys(full.connector).sort(), ['binary', 'download', 'status']); assert.equal(full.gatePort, 4567);
  const raw = JSON.stringify(full); assert(!raw.includes(TOKEN)); assert(!raw.includes('fixture-dedicated-token'));
});

test('a request that is not a management request gets the reduced status even from a direct call', async t => {
  const f = await fixture(t); await connect(f);
  assert.equal((await f.controller.handle('status', {}, { management: false })).canManage, false);
  assert.equal((await f.controller.handle('status')).canManage, false);
  await assert.rejects(f.controller.handle('pause', {}, { management: false }), { code: 'MANAGEMENT' });
  assert.equal(f.controller.snapshot(true).status, 'online');
});

test('every status value is reachable: unconfigured, offline, starting, online, reconnecting, stopping, paused, error', async t => {
  const f = await fixture(t);
  assert.equal(f.controller.snapshot(true).status, 'unconfigured');
  const entered = deferred(), release = deferred();
  f.controller.deps.ensureBinary = async () => { entered.resolve(); await release.promise; return { path: '/x', version: 'x', source: 'installed' }; };
  const started = await f.act('start', SETUP); assert(started.operationId); await entered.promise;
  assert.equal(f.controller.snapshot(true).status, 'starting'); assert.deepEqual(f.controller.snapshot(true).operation, { id: started.operationId, kind: 'start' });
  release.resolve(); await f.settle();
  assert.equal(f.controller.snapshot(true).status, 'online');
  f.connector.status('disconnected'); assert.equal(f.controller.snapshot(true).status, 'reconnecting'); f.connector.status('connected');
  const stopped = deferred();
  f.connector.stop = async () => { f.log.push('connector.stop'); await stopped.promise; };
  const pausing = f.act('pause'); await until(() => f.log.includes('connector.stop'));
  assert.equal(f.controller.snapshot(true).status, 'stopping'); stopped.resolve(); await pausing;
  assert.equal(f.controller.snapshot(true).status, 'paused');
  await f.act('resume'); await f.settle(); assert.equal(f.controller.snapshot(true).status, 'online');
  f.store.state.owned = {}; f.store.state.lastConfigurationCheck = null; await f.act('pause'); await f.act('resume'); await f.settle();
  assert.equal(f.controller.snapshot(true).status, 'error'); assert.equal(f.controller.snapshot(true).issue.code, 'SETUP');
  const idle = await fixture(t, { state: { ...savedState() } });
  assert.equal(idle.controller.snapshot(true).status, 'offline');
});

test('concurrent setup is rejected and cancel waits for the owned operation, leaving the publication offline', async t => {
  const f = await fixture(t, { overrides: { ensureBinary: ({ signal }) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) } });
  await f.act('start', SETUP);
  await assert.rejects(f.act('start', SETUP), { code: 'BUSY' });
  await tick(); await f.act('cancel');
  const s = f.controller.snapshot(true);
  assert.equal(s.status, 'unconfigured'); assert.equal(s.operation, null); assert.equal(s.busy, false); assert.equal(s.issue, null);
  assert.equal(f.store.state.paused, undefined, 'cancel never records a pause');
});

test('cancel during a side request never stops a healthy publication', async t => {
  const f = await fixture(t); await connect(f); f.evidence();
  const gate = f.gate, connector = f.connector; let release, entered = deferred();
  f.api.data.fail = async ({ p }) => { if (p.endsWith('/access/organizations')) { entered.resolve(); await new Promise(r => { release = r; }); } };
  const lookup = f.act('account', { accountId: SETUP.accountId }).catch(e => e);
  await entered.promise; assert.equal(f.controller.snapshot(true).busy, true);
  setTimeout(() => release?.(), 20); await f.act('cancel'); await lookup;
  assert.equal(gate.closed, undefined); assert.equal(connector.stopped, undefined);
  const s = f.controller.snapshot(true); assert.equal(s.status, 'online'); assert.equal(s.busy, false);
  assert.equal(s.authorization.active, true, 'the in-memory grant stays');
  const inspect = f.act('pending/inspect').catch(e => e); await tick(); await f.act('cancel'); await inspect;
  assert.equal(f.controller.snapshot(true).status, 'online');
});

test('cancel during a rebuild closes the partial runtime and ends offline; during a cancelled preflight it leaves the old one', async t => {
  const f = await fixture(t); await connect(f);
  const entered = deferred(); f.controller.deps.ensureBinary = ({ signal }) => { entered.resolve(); return new Promise((_r, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); };
  const old = f.gate; await f.act('start', SETUP); await entered.promise;
  await f.act('cancel');
  assert.equal(old.closed, undefined, 'a preflight that has not replaced anything leaves the running publication alone');
  assert.equal(f.controller.snapshot(true).status, 'online'); assert.equal(f.controller.snapshot(true).issue, null);
  // A rebuild that gets cancelled after the old runtime was closed.
  f.controller.deps.ensureBinary = async () => ({ path: '/x', version: 'x', source: 'installed' });
  f.mode.connector = 'never'; const before = f.connectors.length;
  await f.act('start', SETUP); await until(() => f.connectors.length > before);
  const partial = f.gate; assert.notEqual(partial, old); assert.equal(f.controller.snapshot(true).status, 'starting');
  await f.act('cancel');
  assert(partial.closed); assert(old.closed);
  const s = f.controller.snapshot(true); assert.equal(s.status, 'offline'); assert.equal(s.issue, null); assert.equal(f.store.state.paused, undefined);
});

test('shutdown stops the connector before it closes the gate', async t => {
  const f = await fixture(t); await connect(f);
  f.log.length = 0; await f.act('pause');
  assert.deepEqual(f.log, ['connector.stop', 'gate.close']);
  await f.act('resume'); await f.settle(); f.log.length = 0;
  await f.controller.dispose();
  assert.deepEqual(f.log, ['connector.stop', 'gate.close']);
});

test('pause is persisted, keeps the auto-connect preference, and boot honours it; resume and start clear it', async t => {
  const f = await fixture(t); await connect(f); f.evidence(); await f.act('autoconnect', { enabled: true });
  await f.act('pause');
  const s = f.controller.snapshot(true);
  assert.equal(s.status, 'paused'); assert.equal(s.paused, true); assert.equal(s.autoConnect, true); assert.equal(f.store.state.paused, true); assert.equal(f.store.state.autoConnect, true);
  assert(f.store.saves.at(-1).paused === true, 'the choice reached the saved state');
  assert.equal(f.controller.snapshot(false).paused, true);
  assert.equal(f.controller.bootResume(), false, 'boot auto-connect requires autoConnect && !paused');
  assert.equal(f.controller.resumable(), false);
  await f.act('resume'); await f.settle();
  assert.equal(f.store.state.paused, false); assert.equal(f.controller.snapshot(true).status, 'online');
  await f.act('pause'); await f.act('start', SETUP); await f.settle();
  assert.equal(f.store.state.paused, false); assert.equal(f.controller.snapshot(true).status, 'online');
});

test('a fresh controller on a paused or reviewed or blocked profile does not auto-connect; an eligible one does', async t => {
  for (const [name, patch, expected] of [
    ['eligible', {}, true], ['paused', { paused: true }, false], ['autoConnect off', { autoConnect: false }, false],
    ['host review', { hostReview: { at: 'x' } }, false], ['never verified configuration', { lastConfigurationCheck: null }, false],
    ['unknown write', { pending: { kind: 'access', marker: 'm', at: 'x' } }, false],
    ['legacy session checkpoint', { pending: { kind: 'session', marker: 'm', at: 'x' } }, true],
    ['legacy authentication checkpoint', { pending: { kind: 'authentication', marker: 'm', at: 'x' } }, true],
  ]) {
    const f = await fixture(t, { authorize: false, state: { ...savedState(), ...patch } }); await withToken(f);
    assert.equal(f.controller.bootResume(), expected, name);
    if (expected) { await f.settle(); assert.equal(f.controller.snapshot(true).status, 'online', name); assert.equal(f.controller.snapshot(true).issue, null); }
    else assert.equal(f.controller.operation, null, name);
    // Auto-connect that cannot run without the operator says why instead of sitting silently offline.
    const blocked = { 'never verified configuration': 'SETUP', 'unknown write': 'WRITE_UNKNOWN' }[name];
    if (blocked) { const s = f.controller.snapshot(true); assert.equal(s.status, 'error', name); assert.equal(s.issue.code, blocked, name); }
    if (name === 'autoConnect off' || name === 'paused') assert.equal(f.controller.snapshot(true).issue, null, name);
  }
});

test('disposing or losing ownership stops the runtime without persisting a pause', async t => {
  const f = await fixture(t); await connect(f); f.store.state.autoConnect = true;
  const gate = f.gate, connector = f.connector, saves = f.store.saves.length;
  await f.store.onOwnershipLost();
  assert(gate.closed && connector.stopped);
  assert.equal(f.controller.snapshot(true).issue.code, 'LOCK'); assert.equal(f.store.state.paused, undefined); assert.equal(f.store.saves.length, saves);
  assert.equal(f.store.state.owned.tunnelId, 'tunnel');
  const g = await fixture(t); await connect(g); await g.controller.dispose();
  assert.equal(g.store.state.paused, undefined); assert.equal(g.store.closed, true);
});

test('a retryable resume failure retries automatically with the saved token until it works, and shows retryAt meanwhile', async t => {
  const f = await fixture(t, { authorize: false, state: { ...savedState() } }); await withToken(f);
  f.mode.connector = 'fail';
  assert.equal(f.controller.bootResume(), true); await f.settle();
  let s = f.controller.snapshot(true);
  assert.equal(s.status, 'reconnecting'); assert.equal(s.issue.code, 'CONNECTOR_EXIT'); assert.equal(s.issue.action, 'resume'); assert.match(s.issue.retryAt, /^\d{4}-\d\d-\d\dT/);
  assert(Date.parse(s.issue.retryAt) > Date.now() - 5);
  assert.equal(JSON.stringify(f.controller.snapshot(false)).includes('retryAt'), false, 'the public view carries no schedule');
  await until(() => f.connectors.length >= 4, 'attempts were repeated');
  assert.equal(f.api.data.writes.length, 0, 'recovery never writes to Cloudflare');
  f.mode.connector = 'connect';
  await until(() => f.controller.snapshot(true).status === 'online', 'recovered');
  s = f.controller.snapshot(true); assert.equal(s.issue, null); assert.equal(f.controller.retry, null); assert.equal(f.controller.retryAttempt, 0);
  const count = f.connectors.length; await new Promise(r => setTimeout(r, 80)); assert.equal(f.connectors.length, count, 'no further attempts once it is up');
});

test('the retry backoff is 5, 15, 30, 60 and 120 seconds and then every 300 seconds', async t => {
  const f = await fixture(t, { authorize: false, retryDelaysMs: undefined, retryCapMs: undefined });
  const delays = []; for (let attempt = 0; attempt < 8; attempt++) delays.push(f.controller.retryDelaysMs[attempt] ?? f.controller.retryCapMs);
  assert.deepEqual(delays, [5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 300_000, 300_000]);
});

test('only the listed causes are retried; an unauthenticated success at the edge stays stopped', async t => {
  const f = await fixture(t, { authorize: false, state: { ...savedState() } }); await withToken(f);
  f.controller.fetch = async () => new Response('<html>open</html>', { status: 200 });
  f.controller.bootResume(); await f.settle();
  const s = f.controller.snapshot(true);
  assert.equal(s.status, 'error'); assert.equal(s.issue.code, 'UNPROTECTED'); assert.equal(s.issue.retryAt, undefined); assert.equal(f.controller.retry, null);
  assert(f.gate.closed && f.connector.stopped, 'nothing stays published');
  await new Promise(r => setTimeout(r, 80)); assert.equal(f.connectors.length, 1);
  for (const code of ['SETUP', 'HOST_REVIEW', 'WRITE_UNKNOWN', 'LOCK', 'STATE_WRITE', 'BINARY_OLD', 'DOWNLOAD_APPROVAL', 'ACCESS_CHANGED', 'TUNNEL_CHANGED', 'INTERNAL']) {
    assert.equal(f.controller.scheduleRetry(new CfError(code, 'x')), false, code);
  }
  for (const code of ['CONNECTOR_TIMEOUT', 'CONNECTOR_EXIT', 'EDGE_CHECK', 'DSH_PORT', 'DSH_API', 'DSH_TIMEOUT', 'DSH_CONNECTION', 'GATE_PORT_BUSY']) {
    assert.equal(f.controller.scheduleRetry(new CfError(code, 'x')), true, code); f.controller.cancelRetry();
  }
});

test('a connector that exits while the publication is up is closed and recovered through the resume path', async t => {
  const f = await fixture(t); await connect(f); f.evidence();
  const gate = f.gate, first = f.connector;
  first.status('error'); first.status('stopped'); first.status('connected');
  await tick();
  assert(gate.closed && first.stopped);
  let s = f.controller.snapshot(true);
  assert.equal(s.status, 'reconnecting'); assert.equal(s.issue.code, 'CONNECTOR_EXIT'); assert(s.issue.retryAt);
  assert.equal(s.progress.find(step => step.id === 'tunnel').status, 'error');
  await until(() => f.controller.snapshot(true).status === 'online', 'automatic recovery');
  assert.notEqual(f.connector, first); assert.equal(f.api.data.writes.length, 0); assert.equal(f.controller.snapshot(true).issue, null);
  assert.equal(f.store.state.proven, true, 'earlier verification is kept as data');
});

test('a user action or shutdown cancels the pending retry and a stale timer cannot revive the publication', async t => {
  for (const action of ['pause', 'cancel', 'start', 'remove', 'dispose']) {
    const f = await fixture(t, { state: { ...savedState() } }); await withToken(f);
    f.mode.connector = 'fail'; f.controller.bootResume(); await f.settle();
    assert(f.controller.retry, action); const count = f.connectors.length;
    f.mode.connector = 'fail-stay';
    if (action === 'pause') await f.act('pause');
    else if (action === 'cancel') await f.act('cancel');
    else if (action === 'remove') await f.act('remove', { confirmHostname: HOST });
    else if (action === 'dispose') await f.controller.dispose();
    else { f.mode.connector = 'fail'; await f.act('start', SETUP); }
    if (action !== 'start') { assert.equal(f.controller.retry, null, action); assert.equal(f.controller.retryAttempt, 0, action); }
    await f.settle();
    await new Promise(r => setTimeout(r, 90));
    if (action === 'start') { assert(f.connectors.length - count <= 1, 'only the explicit start ran'); continue; }
    assert.equal(f.connectors.length, count, `${action}: no attempt after the user action`);
    if (action === 'pause') assert.equal(f.controller.snapshot(true).status, 'paused');
  }
  const f = await fixture(t, { state: { ...savedState() } }); await withToken(f);
  f.mode.connector = 'fail'; f.controller.bootResume(); await f.settle();
  const stale = f.controller.retry, generation = f.controller.userGeneration;
  f.controller.userGeneration++; const count = f.connectors.length;
  f.controller.runRetry(stale, generation); await new Promise(r => setTimeout(r, 60));
  assert.equal(f.connectors.length, count, 'a retry from before a user action does nothing');
});

test('a retry that fires while another operation runs looks again instead of consuming an attempt', async t => {
  const f = await fixture(t, { state: { ...savedState() } }); await withToken(f);
  f.mode.connector = 'fail'; f.controller.bootResume(); await f.settle();
  const entered = deferred(), release = deferred();
  f.controller.operation = { id: 'busy', kind: 'refresh', abort: new AbortController(), promise: release.promise };
  const attempts = f.controller.retryAttempt; await new Promise(r => setTimeout(r, 40));
  assert(f.controller.retry, 'still scheduled'); assert.equal(f.controller.retryAttempt, attempts);
  f.controller.operation = null; entered.resolve(); release.resolve();
});

test('host identity review keeps the auto-connect preference, refuses every connect path and resumes after confirmation', async t => {
  const f = await fixture(t, { authorize: false, state: { ...savedState(), hostReview: { at: '2026-10-13T00:00:00.000Z' } } }); await withToken(f);
  assert.deepEqual(f.controller.snapshot(true).hostReview, { at: '2026-10-13T00:00:00.000Z' }); assert.equal(f.controller.snapshot(true).issue.code, 'HOST_REVIEW');
  assert.equal(f.controller.bootResume(), false);
  for (const [endpoint, payload] of [['start', SETUP], ['resume', {}], ['autoconnect', { enabled: true }], ['token/refresh', {}]]) await assert.rejects(f.act(endpoint, payload), { code: 'HOST_REVIEW' }, endpoint);
  assert.equal(f.controller.operation, null); assert.equal(f.store.state.autoConnect, true);
  await assert.rejects(f.act('host/confirm', {}), { code: 'CONSENT' });
  await f.act('host/confirm', { approved: true });
  assert.equal(f.controller.snapshot(true).hostReview, null);
  await f.settle(); await until(() => f.controller.snapshot(true).status === 'online', 'resumed automatically after the confirmation');
  const paused = await fixture(t, { authorize: false, state: { ...savedState(), paused: true, hostReview: { at: 'x' } } }); await withToken(paused);
  await paused.act('host/confirm', { approved: true }); assert.equal(paused.controller.operation, null); assert.equal(paused.controller.snapshot(true).status, 'paused');
  const off = await fixture(t, { authorize: false, state: { ...savedState(), autoConnect: false, hostReview: { at: 'x' } } }); await withToken(off);
  await off.act('host/confirm', { approved: true }); assert.equal(off.controller.operation, null);
});

test('a retry stops when a host review appears in between', async t => {
  const f = await fixture(t, { state: { ...savedState() } }); await withToken(f);
  f.mode.connector = 'fail'; f.controller.bootResume(); await f.settle();
  f.store.state.hostReview = { at: 'x' }; const count = f.connectors.length;
  await new Promise(r => setTimeout(r, 80)); assert.equal(f.connectors.length, count);
});

test('a busy saved gate port fails a resume as retryable, and an authorized start moves to a new port', async t => {
  const busy = createServer(); const taken = await listen(busy); t.after(() => new Promise(r => busy.close(r)));
  const f = await fixture(t, { authorize: false, state: { ...savedState(), gatePort: taken }, overrides: { Gate } }); await withToken(f);
  f.controller.deps.accessVerifier = async () => () => ({});
  f.controller.bootResume(); await f.settle();
  let s = f.controller.snapshot(true);
  assert.equal(s.issue.code, 'GATE_PORT_BUSY'); assert.equal(s.status, 'reconnecting'); assert(s.issue.retryAt); assert.equal(f.store.state.gatePort, taken, 'the saved port is not silently replaced');
  assert.equal(f.connectors.length, 0, 'a failed bind does not start cloudflared');
  assert.equal(f.controller.retryAttempt, 0, 'a busy saved port does not consume the connector backoff');
  const gateWait = Date.parse(s.issue.retryAt) - Date.now();
  assert(gateWait >= 800 && gateWait <= 1_100, `gate retry waited ${gateWait}ms`);
  assert.equal(f.api.data.writes.length, 0);
  await f.act('authorize', { token: TOKEN });
  const ports = []; f.controller.deps.provision = async (_cf, store, setup, port) => { ports.push(port); store.state.setup = setup; store.state.gatePort = port; store.state.owned = { audience: AUD, appId: 'app', tunnelId: 'tunnel', dnsId: 'dns' }; };
  await f.act('start', SETUP); await f.settle();
  s = f.controller.snapshot(true);
  assert.equal(s.status, 'online'); assert.notEqual(f.store.state.gatePort, taken); assert.deepEqual(ports, [f.store.state.gatePort]); assert(f.store.state.gatePort > 0);
});

test('display names saved at setup keep the configured card readable without a token, and deletion drops them', async t => {
  const f = await fixture(t);
  await f.act('account', { accountId: SETUP.accountId });
  await connect(f);
  assert.deepEqual(f.controller.snapshot(true).labels, { account: 'Personal', idp: 'Email PIN' });
  await f.act('forget');
  assert.deepEqual(f.controller.snapshot(true).labels, { account: 'Personal', idp: 'Email PIN' }, 'labels survive forgetting the grant');
  assert.equal(f.controller.snapshot(false).labels, undefined, 'the public view never carries them');
  await f.act('authorize', { token: TOKEN });
  await f.act('remove', { confirmHostname: SETUP.hostname }); await f.settle();
  assert.equal(f.store.state.labels, undefined); assert.equal(f.controller.snapshot(true).labels, null);
});

test('moving to a new gate port voids the configuration check until provisioning rewrites the Tunnel route', async t => {
  const f = await fixture(t, { state: { ...savedState(), gatePort: 5001 } }); await withToken(f);
  f.busyPorts.add(5001);
  f.controller.deps.provision = async () => { throw new CfError('CF_NETWORK', 'Cloudflare did not respond.'); };
  await f.act('start', SETUP); await f.settle();
  assert.equal(f.store.state.gatePort, 4567); assert.equal(f.store.state.lastConfigurationCheck, null, 'the Tunnel still routes to the old port');
  f.busyPorts.clear();
  await f.act('resume'); await f.settle();
  const s = f.controller.snapshot(true);
  assert.equal(s.status, 'error'); assert.equal(s.issue.code, 'SETUP', 'a resume cannot publish on a port the Tunnel does not route to');
});

test('a busy saved port with a mocked gate: the second gate is the one that is kept and closed', async t => {
  const f = await fixture(t, { state: { ...savedState(), gatePort: 5001 } }); await withToken(f);
  f.busyPorts.add(5001);
  await f.act('start', SETUP); await f.settle();
  assert.equal(f.gates.length, 2); assert.equal(f.controller.gate, f.gates[1]); assert.equal(f.store.state.gatePort, 4567);
  await f.act('pause'); assert(f.gates[1].closed);
});

test('a transient Cloudflare read failure keeps the previous configuration check; a read-back mismatch voids it', async t => {
  const f = await fixture(t); await connect(f);
  const checked = f.store.state.lastConfigurationCheck; assert(checked);
  f.controller.deps.provision = async () => { throw new CfError('CF_NETWORK', 'Cloudflare did not respond.'); };
  await f.act('start', SETUP); await f.settle();
  assert.equal(f.store.state.lastConfigurationCheck, checked);
  assert.equal(f.controller.snapshot(true).status, 'error');
  await f.act('resume'); await f.settle(); assert.equal(f.controller.snapshot(true).status, 'online', 'resume and auto-connect keep working');
  for (const code of ['DNS_CHANGED', 'POLICY_CHANGED', 'MFA_CHANGED', 'SESSION_CHANGED', 'ACCESS_CHANGED', 'TUNNEL_CHANGED']) {
    await f.act('resume'); await f.settle();
    f.controller.deps.provision = async () => { throw new CfError(code, 'Read-back did not match'); };
    await f.act('start', SETUP); await f.settle();
    assert.equal(f.store.state.lastConfigurationCheck, null, code); assert(f.store.state.owned.dnsId); assert(await f.store.hasToken());
    await f.act('resume'); await f.settle();
    assert.equal(f.controller.snapshot(true).issue.code, 'SETUP', code);
    f.store.state.lastConfigurationCheck = checked;
  }
});

test('legacy session and authentication checkpoints no longer block a resume', async t => {
  for (const kind of ['session', 'authentication']) {
    const f = await fixture(t, { state: { ...savedState(), pending: { kind, marker: 'm', at: 'x' } } }); await withToken(f);
    assert.equal(f.controller.snapshot(true).pendingWrite, null, 'a legacy checkpoint is not presented as an unknown write');
    await f.act('resume'); await f.settle();
    assert.equal(f.controller.snapshot(true).status, 'online', kind);
  }
  const f = await fixture(t, { state: { ...savedState(), pending: { kind: 'access', marker: 'm', at: 'x' } } }); await withToken(f);
  await f.act('resume'); await f.settle();
  assert.equal(f.controller.snapshot(true).issue.code, 'WRITE_UNKNOWN'); assert.equal(f.controller.snapshot(true).issue.action, 'resolve-write');
  assert.equal(f.controller.snapshot(true).pendingWrite.kind, 'access');
});

test('pending/resolve needs a grant, the exact hostname and a listed mode, inspects Cloudflare itself and ignores client IDs', async t => {
  const f = await fixture(t, { authorize: false }); const marker = `dsh-cf-${f.store.state.instanceId}`;
  f.store.state.setup = SETUP; f.store.state.pending = { kind: 'access', marker, at: 'x', path: '/untrusted' };
  f.api.data.apps.push({ id: 'stray', name: marker, domain: SETUP.hostname });
  await assert.rejects(f.act('pending/resolve', { mode: 'delete-unrecorded', confirmHostname: HOST }), { code: 'AUTHORIZE' });
  await f.act('authorize', { token: TOKEN });
  await assert.rejects(f.act('pending/resolve', { mode: 'delete-unrecorded', confirmHostname: 'other.example.com' }), { code: 'CONFIRM_HOSTNAME' });
  await assert.rejects(f.act('pending/resolve', { mode: 'delete-unrecorded' }), { code: 'CONFIRM_HOSTNAME' });
  await assert.rejects(f.act('pending/resolve', { mode: 'everything', confirmHostname: HOST }), { code: 'PAYLOAD' });
  assert.equal(f.api.data.writes.length, 0); assert(f.store.state.pending);
  const result = await f.act('pending/resolve', { mode: 'delete-unrecorded', confirmHostname: HOST, ids: ['unrelated'], id: 'unrelated', path: '/accounts/x/access/apps/unrelated' });
  assert.deepEqual(result.deleted, [{ type: 'access', id: 'stray' }]);
  assert.deepEqual(f.api.data.writes.map(w => `${w.method} ${w.p.split('/').at(-1)}`), ['DELETE stray']);
  assert.equal(f.store.state.pending, null); assert.equal(f.controller.snapshot(true).pendingWrite, null);
});

test('a pending write that is cleared also clears its WRITE_UNKNOWN issue', async t => {
  const f = await fixture(t, { state: { ...savedState(), pending: { kind: 'access', marker: 'm', at: 'x' } } }); await withToken(f);
  await f.act('resume'); await f.settle(); assert.equal(f.controller.snapshot(true).issue.code, 'WRITE_UNKNOWN');
  f.store.state.pending = { kind: 'access', marker: `dsh-cf-${f.store.state.instanceId}`, at: 'x' };
  await f.act('pending/resolve', { mode: 'clear-not-found', confirmHostname: HOST });
  assert.equal(f.controller.snapshot(true).issue, null);
});

test('trustedHosts added by this plugin are recorded, and the delete flow reverts exactly that edit', async t => {
  const calls = [];
  const added = { hostname: HOST, form: 'array', created: false };
  const f = await fixture(t, { adapter: { async trust() { return { added }; }, async untrust(record) { calls.push(record); return 'reverted'; } } });
  await connect(f);
  assert.deepEqual(f.store.state.trustedHostAdded, added);
  Object.assign(f.store.state, { autoConnect: true, paused: true });
  await f.act('remove', { confirmHostname: HOST }); await f.settle();
  assert.deepEqual(calls, [added]); assert.equal(f.store.state.trustedHostAdded, undefined);
  assert.equal(f.store.state.autoConnect, false); assert.equal(f.store.state.paused, false); assert.equal(f.store.state.setup, null);
  const s = f.controller.snapshot(true); assert.equal(s.trustedHostLeft, null); assert.equal(s.status, 'unconfigured'); assert.equal(s.verified, false);
});

test('a trustedHosts entry that DSH will not remove is left and reported by name', async t => {
  const added = { hostname: HOST, form: 'expr', created: false };
  const f = await fixture(t, { adapter: { async trust() { return { added }; }, async untrust() { return 'left'; } } });
  await connect(f);
  await f.act('remove', { confirmHostname: HOST }); await f.settle();
  assert.equal(f.controller.snapshot(true).trustedHostLeft, HOST); assert.equal(f.store.state.trustedHostAdded, undefined);
  assert.equal(f.controller.snapshot(true).status, 'unconfigured');
});

test('a host that was already trusted is never reverted, and a failed deletion keeps the record', async t => {
  const calls = [];
  const f = await fixture(t, { adapter: { async untrust(record) { calls.push(record); return 'reverted'; } } });
  await connect(f); assert.equal(f.store.state.trustedHostAdded, undefined);
  await f.act('remove', { confirmHostname: HOST }); await f.settle(); assert.deepEqual(calls, []);
  const g = await fixture(t, { overrides: { removeOwned: async () => { throw new CfError('DNS_CHANGED', 'ownership could not be verified'); } }, adapter: { async trust() { return { added: { hostname: HOST, form: 'array', created: false } }; }, async untrust(record) { calls.push(record); return 'reverted'; } } });
  await connect(g);
  await g.act('remove', { confirmHostname: HOST }); await g.settle();
  assert.equal(g.controller.snapshot(true).issue.code, 'DNS_CHANGED'); assert.deepEqual(calls, []); assert(g.store.state.trustedHostAdded);
});

test('correcting the hostname after a failed first attempt undoes the earlier trust edit', async t => {
  const calls = [];
  const f = await fixture(t, { adapter: { async trust(host) { return { added: { hostname: host, form: 'array', created: false } }; }, async untrust(record) { calls.push(record.hostname); return 'reverted'; } } });
  await connect(f);
  f.store.state.owned = {}; f.store.state.setup = null;
  await f.act('start', { ...SETUP, hostname: 'fixed.example.com' }); await f.settle();
  assert.deepEqual(calls, [HOST]); assert.equal(f.store.state.trustedHostAdded.hostname, 'fixed.example.com');
});

test('resource deletion requires exact typed hostname confirmation and removal clears a pause', async t => {
  const f = await fixture(t); f.store.state.setup = SETUP;
  await assert.rejects(f.act('remove', { confirmHostname: 'other.example.com' }), { code: 'CONFIRM_DELETE' });
  await assert.rejects(f.act('remove', {}), { code: 'CONFIRM_DELETE' });
});

test('an expired management grant is cleared, reported as inactive, and refused', async t => {
  const f = await fixture(t);
  const grant = f.controller.snapshot(true).authorization;
  assert.equal(grant.active, true); assert(grant.until > Date.now() && grant.until <= Date.now() + 60 * 60_000);
  f.controller.tokenUntil = Date.now() - 1;
  const s = f.controller.snapshot(true);
  assert.deepEqual(s.authorization, { active: false, until: null }); assert.deepEqual(s.accounts, []); assert.equal(f.controller.token, null);
  await assert.rejects(f.act('account', { accountId: SETUP.accountId }), { code: 'AUTHORIZE' });
  await f.act('authorize', { token: TOKEN }); assert.equal(f.controller.snapshot(true).authorization.active, true);
  await f.act('forget'); assert.deepEqual(f.controller.snapshot(true).authorization, { active: false, until: null });
});

test('status allowlist never returns API tokens or dedicated connector credentials', async t => {
  const f = await fixture(t); await connect(f);
  for (const management of [true, false]) {
    const raw = JSON.stringify(f.controller.snapshot(management)); assert(!raw.includes('management-secret')); assert(!raw.includes('fixture-dedicated-token'));
  }
});

test('negative probe rejects a success/login HTML page rather than accepting HTTP 200', async t => {
  const f = await fixture(t); f.controller.fetch = async () => new Response('<html>login</html>', { status: 200 });
  await assert.rejects(f.controller.negativeProbe(SETUP, new AbortController().signal), { code: 'UNPROTECTED' });
});

test('the gate answers a rejected host or stale generation without touching the publication', async t => {
  const a = await fixture(t), b = await fixture(t);
  assert.notEqual(a.controller.snapshot(true).generation, b.controller.snapshot(true).generation);
  const generation = a.controller.snapshot(true).generation;
  await a.act('pause'); assert.equal(a.controller.snapshot(true).generation, generation);
  await assert.rejects(b.act('pause', { generation }), { code: 'STALE_HOST' });
  assert.equal(b.controller.snapshot(true).status, 'unconfigured'); assert.equal(b.store.state.paused, undefined);
});

test('auto-connect cannot be enabled until browser and real transport verification completes', async t => {
  const f = await fixture(t); await assert.rejects(f.act('autoconnect', { enabled: true }), { code: 'VERIFY_FIRST' });
});

test('shared MFA mutation requires explicit consent', async t => {
  const f = await fixture(t); await assert.rejects(f.act('mfa/enable', { accountId: SETUP.accountId }), { code: 'CONSENT' });
});

test('setup waits for DSH to open its Web listener instead of failing at boot, and a wrong bind address fails at once', async t => {
  const f = await fixture(t); let calls = 0;
  f.controller.adapter.facts = () => { if (++calls < 4) throw new CfError('DSH_PORT', 'not yet'); return {}; };
  await connect(f); assert.equal(f.controller.snapshot(true).status, 'online'); assert(calls >= 4);
  await f.act('pause'); f.controller.adapter.facts = () => { throw new CfError('DSH_BIND', 'public bind'); };
  await f.act('start', SETUP); await f.settle();
  const s = f.controller.snapshot(true); assert.equal(s.status, 'error'); assert.equal(s.issue.code, 'DSH_BIND'); assert.equal(f.controller.retry, null);
});

test('dispose releases profile ownership even if stopping the runtime throws', async t => {
  const f = await fixture(t); await connect(f);
  f.gate.close = async () => { throw new Error('close failed'); };
  await assert.rejects(f.controller.dispose()); assert.equal(f.store.closed, true);
});

test('a refused identity edit preserves the running connection, checks and resume eligibility', async t => {
  const f = await fixture(t); await connect(f); f.evidence();
  const gate = f.gate, connector = f.connector, checked = f.store.state.lastConfigurationCheck;
  for (const [patch, code] of [[{ hostname: 'other.example.com' }, 'SETUP_CHANGED'], [{ ownerEmail: 'other@example.com' }, 'SETUP_CHANGED'], [{ idpId: 'other-provider' }, 'IDP']]) {
    await f.act('start', { ...SETUP, ...patch }); await f.settle();
    const s = f.controller.snapshot(true);
    assert.equal(s.status, 'online'); assert.equal(f.controller.gate, gate); assert.equal(f.controller.connector, connector);
    assert.equal(gate.closed, undefined); assert.equal(connector.stopped, undefined);
    assert.equal(f.store.state.lastConfigurationCheck, checked); assert.deepEqual(f.store.state.setup, SETUP);
    assert.equal(s.issue.code, code, 'the refusal is reported while the connection stays up');
  }
  await f.act('pause'); await f.act('resume'); await f.settle();
  assert.equal(f.controller.snapshot(true).status, 'online');
});

test('binary preflight failure does not tear down a working publication', async t => {
  const f = await fixture(t); await connect(f);
  const gate = f.gate;
  f.controller.deps.ensureBinary = async () => { throw new CfError('BINARY_OLD', 'unsupported'); };
  await f.act('start', SETUP); await f.settle();
  assert.equal(f.controller.gate, gate); assert.equal(gate.closed, undefined);
  const s = f.controller.snapshot(true); assert.equal(s.status, 'online'); assert.equal(s.issue.code, 'BINARY_OLD'); assert.equal(s.issue.action, 'select-binary'); assert(f.store.state.lastConfigurationCheck);
});

test('concurrent pause and dispose share shutdown and retain ownership until the connector exits', async t => {
  const f = await fixture(t); await connect(f);
  const entered = deferred(), release = deferred(); let stops = 0;
  f.connector.stop = async () => { stops++; entered.resolve(); await release.promise; };
  const pausing = f.act('pause'); await entered.promise;
  assert.equal(f.controller.snapshot(true).busy, true);
  await assert.rejects(f.act('resume'), { code: 'BUSY' });
  await assert.rejects(f.act('authorize', { token: 'new-management-token-123456' }), { code: 'BUSY' });
  let disposed = false;
  const disposing = f.controller.dispose().then(() => { disposed = true; });
  await tick(); assert.equal(disposed, false); assert.equal(f.store.closed, false); assert.equal(stops, 1);
  release.resolve(); await Promise.all([pausing, disposing]);
  assert.equal(stops, 1); assert.equal(f.store.closed, true); assert.equal(f.store.state.paused, true);
});

test('dispose waits for cleanup already started by a fatal connector event', async t => {
  const f = await fixture(t); await connect(f);
  const entered = deferred(), release = deferred();
  f.connector.stop = async () => { entered.resolve(); await release.promise; };
  f.connector.status('error'); await entered.promise;
  const disposing = f.controller.dispose(); await tick(); assert.equal(f.store.closed, false);
  release.resolve(); await disposing; assert.equal(f.store.closed, true);
});

for (const endpoint of ['cancel', 'forget']) test(`${endpoint} aborts and drains an MFA change before a new PUT can be sent`, async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); let hold = false, requestSignal;
  const original = f.controller.fetch;
  f.controller.fetch = async (url, options) => {
    options.signal.throwIfAborted();
    if (hold && String(url).endsWith('/access/organizations') && options.method === 'GET') { hold = false; requestSignal = options.signal; entered.resolve(); await release.promise; }
    return original(url, options);
  };
  const account = await f.act('account', { accountId: SETUP.accountId }); hold = true;
  const changing = assert.rejects(f.act('mfa/enable', { accountId: SETUP.accountId, revision: account.organizationRevision, approved: true }));
  await entered.promise; assert.equal(f.controller.snapshot(true).busy, true);
  let finished = false; const cancelling = f.act(endpoint).then(() => { finished = true; });
  await tick(); assert.equal(requestSignal.aborted, true); assert.equal(finished, false);
  release.resolve(); await Promise.all([changing, cancelling]);
  assert.equal(f.api.data.writes.length, 0);
  if (endpoint === 'forget') { assert.equal(f.controller.accountDetails, null); assert.equal(f.controller.token, null); }
});

test('forget prevents a late account response from restoring account state', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); let hold = false;
  const original = f.controller.fetch;
  f.controller.fetch = async (url, options) => { if (hold && String(url).endsWith('/access/organizations')) { entered.resolve(); await release.promise; } return original(url, options); };
  hold = true;
  const reading = assert.rejects(f.act('account', { accountId: SETUP.accountId })); await entered.promise;
  const forgetting = f.act('forget'); release.resolve(); await Promise.all([reading, forgetting]);
  assert.equal(f.controller.accountDetails, null); assert.equal(f.controller.accountList.length, 0); assert.equal(f.controller.token, null);
});

test('a new API token supersedes a grant that is still being verified', async t => {
  const api = fakeCloudflare(), entered = deferred(), release = deferred(); let hold = true;
  const controller = new Controller({ store: memoryStore(), adapter: { invalidate() {} }, fetchImpl: async (url, options) => { if (hold) { hold = false; entered.resolve(); await release.promise; } return api.fetchImpl(url, options); } });
  t.after(() => controller.dispose());
  const old = assert.rejects(controller.handle('authorize', { token: 'old-api-management-token-123' }, { management: true })); await entered.promise;
  await controller.handle('authorize', { token: 'new-api-management-token-123' }, { management: true });
  release.resolve(); await old;
  assert.equal(controller.token, 'new-api-management-token-123');
});

test('cancel aborts authorization and a late account list does not restore the grant', async t => {
  const api = fakeCloudflare(), entered = deferred(), release = deferred(); let hold = false;
  const controller = new Controller({ store: memoryStore(), adapter: { invalidate() {} }, fetchImpl: async (url, options) => {
    if (hold && String(url).includes('/accounts?')) { entered.resolve(); await release.promise; options.signal.throwIfAborted(); }
    return api.fetchImpl(url, options);
  } });
  t.after(() => controller.dispose());
  hold = true;
  const reading = assert.rejects(controller.handle('authorize', { token: 'late-management-token-123456' }, { management: true }));
  await entered.promise;
  const cancelling = controller.handle('cancel', {}, { management: true });
  await tick(); release.resolve();
  await Promise.all([reading, cancelling]);
  assert.equal(controller.token, null); assert.equal(controller.snapshot(true).authorization.active, false); assert.equal(controller.accountList.length, 0);
});

test('token refresh restarts only the connector, and a failed refetch keeps the saved token and the connection', async t => {
  let refreshes = 0;
  const f = await fixture(t, { overrides: { refreshTunnelToken: async (_cf, store) => {
    refreshes++;
    if (refreshes > 1) throw new CfError('CF_NETWORK', 'Cloudflare did not respond.');
    store.token = 'refreshed-connector-token-123456789';
  } } });
  await connect(f);
  const first = f.connector;
  first.stop = async () => { first.stopped = true; first.status('stopped'); };
  await f.act('token/refresh'); await f.settle();
  assert.equal(refreshes, 1); assert.equal(first.stopped, true); assert.notEqual(f.connector, first);
  assert.equal(f.controller.snapshot(true).status, 'online'); assert.equal(f.controller.gate.closed, undefined); assert.equal(f.store.state.owned.tunnelId, 'tunnel');
  const saved = f.store.token, current = f.connector;
  await f.act('token/refresh'); await f.settle();
  const s = f.controller.snapshot(true);
  assert.equal(refreshes, 2); assert.equal(s.status, 'online'); assert.equal(s.issue.code, 'CF_NETWORK'); assert.equal(f.connector, current); assert.equal(current.stopped, undefined);
  assert.equal(f.store.token, saved); assert.equal(JSON.stringify(s).includes(saved), false);
});

test('a frozen refresh failure leaves the running gate and connector up', async t => {
  const frozen = Object.freeze(new CfError('CF_NETWORK', 'Cloudflare did not respond.'));
  const plain = Object.freeze(new Error('super-secret-refresh-detail'));
  let which = frozen;
  const f = await fixture(t, { overrides: { refreshTunnelToken: async () => { throw which; } } });
  await connect(f);
  const connector = f.connector;
  await f.act('token/refresh'); await f.settle();
  assert.equal(frozen.preserveRuntime, undefined); assert.equal(f.controller.snapshot(true).status, 'online'); assert.equal(f.controller.snapshot(true).issue.code, 'CF_NETWORK');
  assert.equal(f.controller.gate.closed, undefined); assert.equal(f.connector, connector);
  which = plain;
  await f.act('token/refresh'); await f.settle();
  assert.equal(plain.preserveRuntime, undefined); assert.equal(f.controller.snapshot(true).issue.code, 'INTERNAL');
  assert.equal(JSON.stringify(f.controller.snapshot(true)).includes('super-secret-refresh-detail'), false);
  assert.equal(f.controller.gate.closed, undefined); assert.equal(f.connector, connector);
});

test('token refresh does not report success when the profile cannot reconnect', async t => {
  const f = await fixture(t, { overrides: { refreshTunnelToken: async () => {} } });
  await f.act('token/refresh'); await f.settle();
  const s = f.controller.snapshot(true);
  assert.equal(s.status, 'unconfigured'); assert.equal(s.issue.code, 'SETUP'); assert.equal(f.controller.gate, null); assert.equal(f.controller.connector, null);
  assert.equal(JSON.stringify(s).includes('management-secret'), false);
});

test('cancel during token refresh before the connector is replaced leaves the publication up and writes no token', async t => {
  const entered = deferred(); let writes = 0;
  const f = await fixture(t, { overrides: { refreshTunnelToken: async (_cf, _store, signal) => {
    entered.resolve();
    await new Promise((_resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    writes++;
  } } });
  await connect(f);
  const before = f.store.token;
  await f.act('token/refresh'); await entered.promise;
  await f.act('cancel');
  assert.equal(writes, 0); assert.equal(f.store.token, before);
  assert.equal(f.controller.snapshot(true).status, 'online'); assert.equal(f.controller.snapshot(true).issue, null);
});

test('reconnect with a saved connector token does not require a management grant', async t => {
  const f = await fixture(t); await connect(f);
  f.controller.clearGrant(); await f.act('pause');
  await f.act('resume'); await f.settle();
  const s = f.controller.snapshot(true); assert.equal(s.status, 'online'); assert.equal(s.authorization.active, false);
});

test('the Store.open failure view explains the problem and refuses everything else', async t => {
  const controller = new UnavailableController(new CfError('LOCK', 'Another DSH is using this profile.'));
  const open = await controller.handle('status');
  assert.deepEqual(Object.keys(open).sort(), ['autoConnect', 'canManage', 'generation', 'issue', 'lastVerifiedAt', 'paused', 'publicUrl', 'sequence', 'status', 'verified', 'version']);
  assert.equal(open.status, 'error'); assert.equal(open.issue.code, 'LOCK');
  const full = await controller.handle('status', {}, { management: true });
  assert.equal(full.canManage, true); assert.equal(full.status, 'error'); assert.equal(full.issue.action, 'close-other-dsh'); assert.equal(full.setup, null);
  await assert.rejects(controller.handle('start', SETUP, { management: true }), { code: 'LOCK' });
  await assert.rejects(controller.handle('start', SETUP), { code: 'MANAGEMENT' });
  const corrupt = new UnavailableController(new CfError('STATE_CORRUPT', 'x'));
  assert.match((await corrupt.handle('status', {}, { management: true })).issue.message, /state\.json/);
  assert.equal(controller.bootResume(), false); await controller.dispose();
});

for (const control of ['cancel', 'pause']) test(`${control} during resume persistence prevents a late connector start`, async t => {
  const f = await fixture(t, { state: { ...savedState(), paused: true } }); await withToken(f);
  const entered = deferred(), release = deferred(), save = f.store.save.bind(f.store);
  let first = true;
  f.store.save = async () => { if (first) { first = false; entered.resolve(); await release.promise; } return save(); };
  const starting = f.act('resume'); await entered.promise;
  const stopping = f.act(control);
  await tick(); release.resolve();
  await Promise.all([starting, stopping]); await f.settle();
  assert.equal(f.connectors.length, 0, 'a cancelled resume must never publish later');
  assert.equal(f.controller.gate, null);
  if (control === 'pause') assert.equal(f.store.state.paused, true);
});
