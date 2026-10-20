import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CfError, demand, safeError, pause, timeout } from './common.js';
import { Cloudflare, provision, removeOwned, refreshTunnelToken, assertSetupChange, inspectPending, resolvePending, PENDING_MODES, blockingPending, invalidatesConfiguration } from './cloudflare.js';
import { ensureBinary, Connector, stopRecordedConnector, readProcessStart } from './connector.js';
import { accessVerifier } from './access.js';
import { Gate } from './gate.js';
import manifest from '../package.json' with { type: 'json' };

export const VERSION = manifest.version;
const STEP_IDS = ['environment', 'authorization', 'access', 'tunnel', 'browser', 'dsh'];
const freshSteps = () => STEP_IDS.map(id => ({ id, status: 'idle', message: '' }));
const GRANT_MS = 60 * 60_000;
// Failures that a later attempt can plausibly fix without anyone acting. Everything else stays stopped.
// UNPROTECTED (the edge answered an unauthenticated request with success) is deliberately absent: default deny.
const RETRYABLE = new Set(['CONNECTOR_TIMEOUT', 'CONNECTOR_EXIT', 'EDGE_CHECK', 'DSH_PORT', 'DSH_API', 'DSH_TIMEOUT', 'DSH_CONNECTION', 'GATE_PORT_BUSY']);
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000];
const RETRY_CAP_MS = 300_000;
// The next safe step for an issue, as a stable token for the client to turn into a button or a hint.
const ACTIONS = { AUTHORIZE: 'authorize', API_TOKEN: 'authorize', HOST_REVIEW: 'confirm-host', WRITE_UNKNOWN: 'resolve-write', DOWNLOAD_APPROVAL: 'approve-download', BINARY_PATH: 'select-binary', BINARY_OLD: 'select-binary', BINARY_EXEC: 'select-binary', SETUP: 'start', VERIFY_FIRST: 'verify', LOCK: 'close-other-dsh', GATE_PORT_BUSY: 'start' };

export function issueOf(error) {
  const { code, message, details } = safeError(error);
  const issue = { code, message };
  if (details?.reason === 'start-time' || details?.reason === 'stuck' || details?.reason === 'unverified-after-signal') issue.reason = details.reason;
  const action = ACTIONS[code] ?? (RETRYABLE.has(code) ? 'resume' : undefined);
  if (action) issue.action = action;
  return issue;
}
const DISCONNECTED = { code: 'TUNNEL_DISCONNECTED', message: 'cloudflared lost its connection to Cloudflare and is reconnecting by itself. Nothing needs to be done unless this stays.' };

/** Host-owned workflow; panel lifetime does not own an in-flight operation. */
export class Controller {
  /**
   * @param retryDelaysMs - delays for the automatic recovery attempts; the last one repeats `retryCapMs` afterwards.
   */
  constructor({ store, adapter, config = {}, fetchImpl = fetch, dependencies = {}, retryDelaysMs = RETRY_DELAYS_MS, retryCapMs = RETRY_CAP_MS }) {
    this.store = store; this.adapter = adapter; this.config = config; this.fetch = fetchImpl;
    this.deps = { ensureBinary, Connector, accessVerifier, Gate, provision, removeOwned, refreshTunnelToken, stopRecordedConnector, readProcessStart, ...dependencies };
    this.generation = randomUUID(); this.seq = 0; this.steps = freshSteps();
    this.operation = null; this.gate = null; this.connector = null; this.connectorStatus = null; this.published = false;
    this.failure = null; this.warning = null; this.evidence = {}; this.binary = null; this.download = null; this.trustedHostLeft = null;
    this.token = null; this.tokenUntil = 0; this.grantTimer = null; this.accountList = []; this.accountDetails = null;
    this.authGeneration = 0; this.requests = new Set(); this.stopping = null; this.closingRuntime = null; this.forgetting = null; this.disposed = false;
    this.retry = null; this.retryAttempt = 0; this.userGeneration = 0; this.retryDelaysMs = retryDelaysMs; this.retryCapMs = retryCapMs; this.verifiedThisRuntime = false;
    store.onOwnershipLost = async () => {
      try { await this.shutdown(); }
      finally { this.failure = { code: 'LOCK', message: 'Profile ownership was lost. Publication was stopped. Restart this DSH.', action: 'close-other-dsh' }; this.changed(); }
    };
  }
  changed() { this.seq++; }
  step(id, status, message = '') {
    const step = this.steps.find(s => s.id === id); if (!step || (step.status === status && step.message === message)) return;
    Object.assign(step, { status, message }); this.changed();
  }

  // ---- Management grant (memory only) ----
  expireGrant() {
    if (this.token && Date.now() >= this.tokenUntil) this.clearGrant();
  }
  clearGrant() {
    clearTimeout(this.grantTimer); this.grantTimer = null;
    this.token = null; this.tokenUntil = 0; this.accountList = []; this.accountDetails = null; this.changed();
  }
  cf() {
    this.expireGrant();
    demand(this.token, 'AUTHORIZE', 'Authorize Cloudflare again. Management grants are intentionally not stored on disk.');
    return new Cloudflare(this.token, this.fetch);
  }
  invalidateAuthorization() {
    this.authGeneration++;
    for (const request of this.requests) request.abort.abort(new DOMException('Cancelled', 'AbortError'));
    return this.authGeneration;
  }
  checkAuthorization(generation, signal) {
    signal.throwIfAborted();
    demand(generation === this.authGeneration, 'AUTH_SUPERSEDED', 'This authorization was superseded or cancelled.');
    demand(!this.disposed && !this.stopping, 'STOPPED', 'Plugin is stopping.');
    demand(!this.operation, 'BUSY', 'Another operation is still in progress.');
  }
  request(run, generation = this.authGeneration, kind = 'request') {
    const request = { id: randomUUID(), kind, abort: new AbortController(), promise: null };
    this.requests.add(request); this.changed();
    request.promise = Promise.resolve().then(() => {
      this.checkAuthorization(generation, request.abort.signal);
      return run(request.abort.signal, () => this.checkAuthorization(generation, request.abort.signal));
    }).finally(() => { this.requests.delete(request); this.changed(); });
    return request.promise;
  }
  authorize(token) {
    const generation = this.invalidateAuthorization();
    return this.request(async (signal, check) => {
      const accounts = await new Cloudflare(token, this.fetch).accounts(signal);
      check();
      this.token = token; this.tokenUntil = Date.now() + GRANT_MS; this.accountList = accounts; this.accountDetails = null;
      clearTimeout(this.grantTimer); this.grantTimer = setTimeout(() => this.expireGrant(), GRANT_MS + 50); this.grantTimer.unref?.();
      this.step('authorization', 'done', 'Cloudflare API authorization verified'); this.changed(); return { accounts };
    }, generation, 'authorize');
  }
  account(payload, enableMfa = false) {
    demand(!this.requests.size, 'BUSY', 'Another management request is still in progress.');
    const cf = this.cf();
    return this.request(async (signal, check) => {
      const details = enableMfa ? await cf.enableMfa(payload.accountId, payload.revision, signal) : await cf.account(payload.accountId, signal);
      check();
      this.accountDetails = { ...details, accountId: payload.accountId }; this.changed(); return this.accountDetails;
    }, undefined, 'account');
  }
  forget() {
    this.invalidateAuthorization();
    const requests = [...this.requests].map(request => request.promise);
    this.clearGrant();
    const forgetting = { abort: new AbortController(), promise: null };
    this.forgetting = forgetting;
    forgetting.promise = Promise.allSettled(requests).then(() => ({})).finally(() => { if (this.forgetting === forgetting) this.forgetting = null; this.changed(); });
    return forgetting.promise;
  }

  // ---- Status ----
  /** One word for the whole publication. It never depends on a browser being connected. */
  status() {
    const s = this.store.state;
    if (this.stopping) return 'stopping';
    const op = this.operation;
    if (this.gate && this.published) return this.connector && this.connectorStatus === 'connected' ? 'online' : 'reconnecting';
    if (op && (op.kind === 'start' || op.kind === 'resume')) return op.auto && this.retryAttempt > 0 ? 'reconnecting' : 'starting';
    if (!s.setup) return 'unconfigured';
    if (this.retry) return 'reconnecting';
    if (s.paused) return 'paused';
    if (this.failure) return 'error';
    return 'offline';
  }
  issue() {
    const s = this.store.state;
    if (this.failure) {
      const issue = { ...this.failure };
      if (this.retry) issue.retryAt = new Date(this.retry.at).toISOString();
      return issue;
    }
    if (s.hostReview) return { code: 'HOST_REVIEW', message: 'This profile was last used under a different host identity. Confirm in the local settings that no other DSH uses its Tunnel before connecting.', action: 'confirm-host' };
    if (this.warning) return { ...this.warning };
    if (this.gate && this.published && this.connectorStatus !== 'connected' && !this.stopping) return { ...DISCONNECTED };
    return null;
  }
  /**
   * @param management - true only for a request that passed `isManagementRequest`. Anything else gets the reduced view:
   * no account lists, resource IDs, local paths, ports, or setup details.
   */
  snapshot(management = false) {
    this.expireGrant();
    const s = this.store.state, issue = this.issue();
    const base = { generation: this.generation, sequence: this.seq, version: VERSION, canManage: management === true, status: this.status() };
    const publicUrl = s.setup ? `https://${s.setup.hostname}/` : null;
    if (management !== true) {
      return { ...base, issue: issue && { code: issue.code, message: issue.message }, publicUrl, verified: s.proven === true, lastVerifiedAt: s.lastVerifiedAt ?? null, autoConnect: s.autoConnect === true, paused: s.paused === true };
    }
    return {
      ...base, issue,
      busy: !!(this.operation || this.stopping || this.forgetting || this.requests.size),
      operation: this.operation ? { id: this.operation.id, kind: this.operation.kind } : null,
      progress: this.steps.map(step => ({ ...step })),
      setup: s.setup, resources: { ...s.owned }, autoConnect: s.autoConnect === true, paused: s.paused === true,
      verified: s.proven === true, lastVerifiedAt: s.lastVerifiedAt ?? null, lastConfigurationCheck: s.lastConfigurationCheck ?? null,
      hostReview: s.hostReview ?? null, pendingWrite: blockingPending(s) ? { kind: s.pending.kind, at: s.pending.at } : null,
      authorization: { active: !!this.token, until: this.token ? this.tokenUntil : null },
      accounts: this.accountList, account: this.accountDetails,
      publicUrl, enrollmentUrl: s.setup ? `https://${s.setup.teamDomain}/` : this.accountDetails ? `https://${this.accountDetails.teamDomain}/` : null,
      connector: { status: this.connector ? this.connectorStatus : 'stopped', binary: this.binary, download: this.download },
      evidence: { unauthenticatedRejected: !!this.evidence.unauthenticatedRejected, owner: !!this.evidence.owner, http: !!this.evidence.http, api: !!this.evidence.api, websocket: !!this.evidence.websocket },
      gatePort: s.gatePort ?? 0, trustedHostLeft: this.trustedHostLeft, labels: s.setup && s.labels ? { ...s.labels } : null,
    };
  }
  hostConfirmed() {
    demand(!this.store.state.hostReview, 'HOST_REVIEW', 'This profile was last used under a different host identity. Confirm in the local settings that no other DSH uses its Tunnel before connecting.');
  }
  /** Refuses new work while an operation, a shutdown or (unless `requests` is false) a management request is in flight. */
  idle({ requests = true } = {}) {
    demand(!this.disposed, 'STOPPED', 'Plugin is stopping.');
    demand(!this.operation && !this.stopping && !this.forgetting && !(requests && this.requests.size), 'BUSY', 'Another operation is still in progress.');
  }
  /** DSH may still be opening its Web listener at boot or reloading Connection after a trust edit. */
  async dshFacts(signal) {
    const deadline = Date.now() + 30_000;
    for (;;) {
      try { return this.adapter.facts(); }
      catch (e) { if (!(e instanceof CfError) || !['DSH_PORT', 'DSH_API'].includes(e.code) || Date.now() >= deadline) throw e; }
      await pause(250, signal);
    }
  }

  // ---- Actions ----
  async handle(endpoint, payload = {}, { management = false } = {}) {
    demand(payload && typeof payload === 'object' && !Array.isArray(payload), 'PAYLOAD', 'Expected an object payload.');
    if (endpoint === 'status') return this.snapshot(management);
    demand(management === true, 'MANAGEMENT', 'Management is local only.');
    demand(payload.generation === undefined || payload.generation === this.generation, 'STALE_HOST', 'DSH restarted. Read its current status before changing settings.');
    demand(!this.disposed, 'STOPPED', 'Plugin is stopping.');
    const s = this.store.state;
    // Cancel drains the current operation or request. Pause also persists the choice. Neither needs an idle controller.
    if (endpoint === 'cancel') { await this.cancel(); return this.snapshot(true); }
    if (endpoint === 'pause') { await this.pauseNow(); return this.snapshot(true); }
    // A new grant or forgetting one supersedes management requests that are still in flight.
    this.idle({ requests: endpoint !== 'authorize' && endpoint !== 'forget' });
    switch (endpoint) {
      case 'authorize':
        demand(typeof payload.token === 'string' && payload.token.length <= 16_384, 'API_TOKEN', 'Invalid API token.');
        return this.authorize(payload.token.trim());
      case 'account': return this.account(payload);
      case 'token/refresh': this.hostConfirmed(); this.cancelRetry(); return this.launch('refresh', signal => this.refreshAndReconnect(signal));
      case 'pending/inspect': {
        const cf = this.cf();
        return this.request(signal => inspectPending(cf, this.store, signal), undefined, 'inspect');
      }
      case 'pending/resolve': {
        demand(PENDING_MODES.includes(payload.mode), 'PAYLOAD', 'Choose one of the listed recovery actions.');
        demand(!!s.setup && payload.confirmHostname === s.setup.hostname, 'CONFIRM_HOSTNAME', 'Type this instance’s exact hostname to confirm the recovery action.');
        const cf = this.cf();
        return this.request(async signal => {
          const result = await resolvePending(cf, this.store, payload.mode, signal);
          if (this.failure?.code === 'WRITE_UNKNOWN') this.failure = null;
          this.changed(); return result;
        }, undefined, 'resolve-write');
      }
      case 'mfa/enable':
        demand(payload.approved === true, 'CONSENT', 'Review and explicitly approve the additive organization MFA change.');
        return this.account(payload, true);
      case 'start': {
        this.hostConfirmed(); this.cancelRetry();
        return this.launch('start', async signal => { await this.setPaused(false); signal.throwIfAborted(); return this.start(payload, signal, false); });
      }
      case 'resume': {
        this.hostConfirmed(); this.cancelRetry();
        return this.launch('resume', async signal => { await this.setPaused(false); signal.throwIfAborted(); return this.start({}, signal, true); });
      }
      case 'host/confirm': {
        demand(payload.approved === true, 'CONSENT', 'Confirm that no other DSH uses this profile’s Tunnel.');
        await this.store.confirmHost(); this.failure = this.failure?.code === 'HOST_REVIEW' ? null : this.failure; this.changed();
        this.bootResume();
        return {};
      }
      case 'autoconnect':
        demand(typeof payload.enabled === 'boolean', 'PAYLOAD', 'Expected a boolean.');
        demand(!payload.enabled || s.proven === true, 'VERIFY_FIRST', 'Complete browser/API/WebSocket verification before enabling auto-connect.');
        if (payload.enabled) this.hostConfirmed();
        s.autoConnect = payload.enabled; await this.store.save(); this.changed(); return {};
      case 'forget': return this.forget();
      case 'remove': {
        demand(payload.confirmHostname === s.setup?.hostname && !!payload.confirmHostname, 'CONFIRM_DELETE', 'Type this instance’s exact hostname to delete its public resources.');
        const cf = this.cf(); this.cancelRetry();
        return this.launch('remove', async signal => {
          this.operation.rebuilding = true;
          s.autoConnect = false; s.paused = false; await this.store.save();
          await this.closeRuntime();
          await this.deps.removeOwned(cf, this.store, signal);
          // Undo only the trustedHosts entry this plugin added. If DSH refuses, leave it and say so.
          const record = s.trustedHostAdded; this.trustedHostLeft = null;
          if (record) {
            if (await this.adapter.untrust(record) === 'left') this.trustedHostLeft = record.hostname;
            delete s.trustedHostAdded;
          }
          s.proven = false; s.lastVerifiedAt = null; s.lastConfigurationCheck = null; delete s.labels; await this.store.save();
          this.failure = null; this.warning = null; this.steps = freshSteps(); this.evidence = {}; this.changed();
        });
      }
      default: throw new CfError('ENDPOINT', 'Unknown settings action.');
    }
  }
  async setPaused(value) {
    const s = this.store.state;
    if ((s.paused === true) === value) return;
    s.paused = value; await this.store.save(); this.changed();
  }
  /**
   * Starts one long operation. `auto` marks boot and recovery attempts, which keep showing the earlier failure
   * while they run. A failed resume with a retryable cause schedules the next attempt.
   */
  launch(kind, run, { auto = false } = {}) {
    this.idle();
    const operation = { id: randomUUID(), kind, auto, rebuilding: false, abort: new AbortController(), promise: null };
    this.operation = operation; if (!auto) { this.failure = null; this.warning = null; } this.changed();
    operation.promise = Promise.resolve().then(() => run(operation.abort.signal)).then(() => {
      this.retryAttempt = 0; this.failure = null;
    }, async error => {
      const aborted = operation.abort.signal.aborted;
      const keep = error?.preserveRuntime === true && !aborted;
      // A cancelled preflight leaves a working publication alone. Once the runtime is being rebuilt, a partial one is closed.
      if (!keep && (!aborted || operation.rebuilding)) await this.closeRuntime().catch(() => {});
      if (keep) this.failure = issueOf(error);
      else if (aborted) this.failure = null;
      else this.failure = issueOf(error);
      for (const step of this.steps) if (step.status === 'working') { step.status = aborted ? 'idle' : 'error'; step.message = this.failure?.message || 'Cancelled'; }
      if (!aborted && !keep && kind === 'resume') this.scheduleRetry(error);
    }).finally(() => {
      if (this.operation === operation) this.operation = null;
      this.changed();
      if (this.published && this.connectorStatus === 'error' && !this.stopping) this.connectorDied();
    });
    return { operationId: operation.id };
  }

  // ---- Automatic recovery ----
  cancelRetry() {
    clearTimeout(this.retry?.timer); this.retry = null; this.retryAttempt = 0; this.userGeneration++;
  }
  /** Schedules the next resume attempt for a retryable failure while nobody has paused, cancelled or removed the publication. */
  scheduleRetry(error) {
    const s = this.store.state;
    if (this.disposed || this.stopping || s.paused || s.hostReview || !s.setup || !RETRYABLE.has(error?.code)) return false;
    clearTimeout(this.retry?.timer);
    // A busy saved gate port is the previous process still holding it. Retry quickly instead of the long connector backoff.
    const portBusy = error?.code === 'GATE_PORT_BUSY';
    const delay = portBusy ? 1_000 : (this.retryDelaysMs[this.retryAttempt] ?? this.retryCapMs);
    if (!portBusy) this.retryAttempt++;
    const generation = this.userGeneration;
    const retry = { at: Date.now() + delay, error, timer: setTimeout(() => this.runRetry(retry, generation), delay) };
    retry.timer.unref?.();
    this.retry = retry; this.changed(); return true;
  }
  runRetry(retry, generation) {
    if (this.retry !== retry) return;
    this.retry = null;
    const s = this.store.state;
    if (generation !== this.userGeneration || this.disposed || s.paused || s.hostReview) return;
    try { this.launch('resume', signal => this.start({}, signal, true), { auto: true }); }
    catch (error) {
      // Another operation is running. Look again at the same pace instead of consuming an attempt.
      if (error?.code !== 'BUSY') return;
      this.retryAttempt = Math.max(0, this.retryAttempt - 1); this.scheduleRetry(retry.error);
    }
    this.changed();
  }
  /** Boot and host-confirmation recovery: resume when everything that auto-connect promises is true. */
  resumable() {
    const s = this.store.state;
    return !this.disposed && !!s.setup && s.autoConnect === true && s.paused !== true && !s.hostReview && !!s.lastConfigurationCheck && !blockingPending(s);
  }
  bootResume() {
    if (!this.resumable()) { this.explainBlockedAutoConnect(); return false; }
    if (this.operation || this.stopping || this.gate || this.retry) return false;
    try { this.launch('resume', signal => this.start({}, signal, true), { auto: true }); return true; }
    catch { return false; }
  }

  /**
   * Auto-connect is on but cannot run without the operator (an unfinished configuration check or an unknown write).
   * Say so instead of sitting silently offline. A host review and a pause already explain themselves.
   */
  explainBlockedAutoConnect() {
    const s = this.store.state;
    if (this.disposed || !s.setup || s.autoConnect !== true || s.paused === true || s.hostReview || this.failure || this.operation || this.gate) return;
    this.failure = blockingPending(s)
      ? { code: 'WRITE_UNKNOWN', message: 'Auto-connect is on, but an earlier Cloudflare write has an unknown result. Resolve it in the local settings, then reconnect.', action: 'resolve-write' }
      : { code: 'SETUP', message: 'Auto-connect is on, but the last setup did not finish its Cloudflare configuration check. Authorize Cloudflare in the local settings and save the connection again.', action: 'start' };
    this.changed();
  }

  // ---- Publication ----
  makeGate(setup) {
    const gate = new this.deps.Gate({ host: setup.hostname, instanceId: this.store.state.instanceId, adapter: this.adapter, verify: null,
      onEvidence: kind => { if (this.gate === gate) this.recordEvidence(kind); },
      onFault: event => { if (this.gate === gate) this.noteFault(event); },
      onHealthy: () => { if (this.gate === gate) this.noteHealthy(); } });
    return gate;
  }
  async start(input, signal, resume) {
    const s = this.store.state, operation = this.operation;
    let setup, selected, binary;
    try {
      this.hostConfirmed();
      demand(!blockingPending(s), 'WRITE_UNKNOWN', 'Resolve the unknown write before reconnecting.');
      setup = resume ? s.setup : await this.cf().validateSetup(input, signal);
      demand(setup, 'SETUP', 'Complete initial setup first.');
      assertSetupChange(s.setup, setup, s.owned);
      if (resume) demand(s.lastConfigurationCheck && s.owned.audience && s.owned.dnsId && await this.store.hasToken(), 'SETUP', 'Initial provisioning did not finish. Authorize and retry setup.');
      await this.dshFacts(signal);
      selected = input.cloudflaredPath || this.config.cloudflaredPath || s.selectedBinary || '';
      binary = await this.deps.ensureBinary({ dir: this.store.dir, selected, allowDownload: !resume && input.allowDownload === true, signal, fetchImpl: this.fetch, onProgress: value => { this.download = value; this.changed(); } });
      signal.throwIfAborted();
    } catch (error) {
      this.download = null;
      if (this.gate && this.connector && !signal.aborted) {
        const failure = error instanceof CfError ? new CfError(error.code, error.message, error.details) : new CfError('INTERNAL', 'The settings could not be checked. The running connection was retained.');
        failure.preserveRuntime = true; throw failure;
      }
      throw error;
    }
    if (operation) operation.rebuilding = true;
    await this.closeRuntime(); signal.throwIfAborted(); this.evidence = {}; this.warning = null; this.verifiedThisRuntime = false; this.steps = freshSteps();
    this.binary = binary; this.step('environment', 'working', 'Checking DSH and cloudflared');
    this.download = null; s.selectedBinary = selected; await this.store.save();
    signal.throwIfAborted(); this.step('environment', 'done', `${this.binary.source}: ${this.binary.version}`);
    this.step('authorization', 'done', resume ? 'Saved connector token; management grant not required' : 'Selected Cloudflare resources verified');
    this.step('access', 'working', 'Applying the supported DSH Host trust configuration');
    await this.trustHost(setup.hostname); signal.throwIfAborted();
    // Takeover already stopped the recorded cloudflared, or refused to start because that process
    // could not be confirmed. Bind the saved gate port before any new cloudflared: resume never
    // moves that port, and a failed bind must not reach Connector.start.
    await this.releaseInheritedConnector(signal);
    await this.assertStartTimeReadable();
    const port = await this.listen(setup, s, resume);
    const gate = this.gate;
    try {
      if (!resume) {
        signal.throwIfAborted();
        try { await this.deps.provision(this.cf(), this.store, setup, port, signal, phase => this.step(phase === 'access' ? 'access' : 'tunnel', 'working', `Configuring ${phase}`)); }
        catch (error) {
          // A mismatch read back from Cloudflare means the earlier check no longer proves anything. A failed read does not.
          if (invalidatesConfiguration(error)) { s.lastConfigurationCheck = null; await this.store.save().catch(() => {}); }
          throw error;
        }
        s.labels = this.labelsFor(setup);
        s.lastConfigurationCheck = new Date().toISOString(); await this.store.save();
      }
      gate.verify = await this.deps.accessVerifier({ ...setup, audience: s.owned.audience });
      this.step('access', 'done', resume ? `Owner/JWT gate active; Cloudflare configuration last checked ${s.lastConfigurationCheck || 'during setup'}` : setup.requireWebAuthn === false ? 'Owner-only Access sign-in policy verified' : 'Owner-only Access and WebAuthn policy verified');
      this.step('tunnel', 'working', 'Waiting for cloudflared registration');
      const connector = new this.deps.Connector(status => this.onConnectorStatus(connector, status));
      this.connector = connector; this.connectorStatus = 'starting';
      await this.store.assertOwnership?.();
      try {
        await connector.start(this.binary.path, join(this.store.dir, 'tunnel.token'));
        await this.rememberConnector(connector);
      } catch (error) {
        if (signal.aborted || error?.code === 'LOCK') throw error;
        throw new CfError('CONNECTOR_EXIT', 'cloudflared could not be started. Check the executable and reconnect.');
      }
      await this.awaitConnector(connector, signal, 'cloudflared did not establish a connection. Check outbound connectivity and the connector token.');
      this.step('browser', 'working', 'Checking rejection without authentication');
      await this.negativeProbe(setup, signal);
      signal.throwIfAborted();
      demand(this.connector === connector && this.gate === gate && this.connectorStatus !== 'error', 'CONNECTOR_EXIT', 'cloudflared stopped during verification. Check the connector and reconnect.');
      this.evidence.unauthenticatedRejected = true; this.published = true;
      this.step('browser', this.evidence.owner ? 'done' : 'waiting', this.evidence.owner ? 'Signed owner identity verified' : 'Waiting for the owner to sign in');
      this.step('dsh', 'waiting', 'Waiting for real DSH HTTP, API, and WebSocket traffic');
      this.changed(); this.maybeVerified();
    } catch (e) { await this.closeRuntime(); throw e; }
  }
  /** Display names for the saved setup, from the lists this grant loaded. They are labels only and never select a resource. */
  labelsFor(setup) {
    const name = value => (typeof value === 'string' && value.length > 0 ? value.slice(0, 200) : null);
    const details = this.accountDetails?.accountId === setup.accountId ? this.accountDetails : null;
    const previous = this.store.state.labels;
    return {
      account: name(this.accountList.find(item => item.id === setup.accountId)?.name) ?? previous?.account ?? null,
      idp: name(details?.idps?.find(item => item.id === setup.idpId)?.name) ?? previous?.idp ?? null,
    };
  }
  async trustHost(hostname) {
    const s = this.store.state;
    const old = s.trustedHostAdded;
    if (old && old.hostname !== hostname) {
      // An identity corrected after a failed first attempt: undo the earlier edit before recording the new one.
      if (await this.adapter.untrust(old) === 'left') this.trustedHostLeft = old.hostname;
      delete s.trustedHostAdded;
    }
    const trusted = await this.adapter.trust(hostname);
    if (trusted?.added) s.trustedHostAdded = trusted.added;
    if (trusted?.added || old) await this.store.save();
  }
  /** This machine must be able to record a start time before any cloudflared is created. */
  async assertStartTimeReadable() {
    if (await this.deps.readProcessStart(process.pid) == null) {
      throw new CfError('LOCK', 'A process start time could not be read, so cloudflared was not started.', { reason: 'start-time' });
    }
  }
  /** Stop the cloudflared recorded by the previous owner before this process starts its own. */
  async releaseInheritedConnector(signal) {
    const record = this.store.inheritedConnector;
    if (!record) return;
    await this.store.assertOwnership?.();
    const outcome = await this.deps.stopRecordedConnector(record, { ...(this.deps.connectorIo || {}), signal });
    if (outcome === 'stopped' || outcome === 'replaced') { this.store.inheritedConnector = null; return; }
    const reason = outcome === 'stuck' ? 'stuck' : outcome === 'unverified-after-signal' ? 'unverified-after-signal' : 'start-time';
    const message = reason === 'stuck'
      ? 'The previous cloudflared was still present after it was stopped, so another was not started.'
      : reason === 'unverified-after-signal'
        ? 'A stop signal was sent to the previous cloudflared, but this computer could not confirm that it had exited, so another was not started.'
        : 'The previous cloudflared could not be confirmed, so it was not stopped and another was not started.';
    throw new CfError('LOCK', message, { reason });
  }
  async rememberConnector(connector) {
    if (typeof this.store.recordConnector !== 'function') return;
    const pid = connector?.cloudflaredPid;
    if (!pid) {
      if (!connector?.reportsPid) return;
      await connector.stop?.().catch(() => {});
      throw new CfError('LOCK', 'cloudflared did not report its process id, so it was stopped and another was not started.', { reason: 'start-time' });
    }
    const start = await this.deps.readProcessStart(pid);
    if (start == null) {
      let alive = true;
      try { process.kill(pid, 0); }
      catch (error) { if (error?.code === 'ESRCH') alive = false; }
      if (!alive) throw new CfError('CONNECTOR_EXIT', 'cloudflared exited before its start time could be recorded.');
      await connector.stop?.().catch(() => {});
      throw new CfError('LOCK', 'The new cloudflared start time could not be read, so that process was stopped and another was not started.', { reason: 'start-time' });
    }
    await this.store.recordConnector({ pid, start });
  }
  /** Binds the loopback gate. A busy saved port is an error on resume (the Tunnel routes to it) and is replaced on an authorized start. */
  async listen(setup, s, resume) {
    let gate = this.makeGate(setup); this.gate = gate;
    let port;
    try { port = await gate.start(s.gatePort || 0); }
    catch (error) {
      if (error?.code !== 'EADDRINUSE' || !s.gatePort) throw error;
      await gate.close().catch(() => {});
      demand(!resume, 'GATE_PORT_BUSY', 'The local port that the Tunnel routes to is in use by another program. Reconnecting without Cloudflare access cannot change it; free the port, or authorize Cloudflare and start again to move to a new port.');
      gate = this.makeGate(setup); this.gate = gate; port = await gate.start(0);
      // The Tunnel still routes to the old port until provisioning rewrites it. Until then a resume must not
      // trust the earlier configuration check, or cloudflared would forward owner traffic to whatever holds that port.
      s.lastConfigurationCheck = null;
    }
    s.gatePort = port; await this.store.save();
    return port;
  }
  async awaitConnector(connector, signal, timeoutMessage) {
    const deadline = Date.now() + 60_000;
    while (this.connector === connector && this.connectorStatus !== 'connected') {
      signal.throwIfAborted();
      demand(!['error', 'stopped'].includes(this.connectorStatus), 'CONNECTOR_EXIT', 'cloudflared stopped before it connected. Check the connector and reconnect.');
      demand(Date.now() < deadline, 'CONNECTOR_TIMEOUT', timeoutMessage);
      await pause(200, signal);
    }
  }
  async negativeProbe(setup, signal) {
    for (let attempt = 0; attempt < 10; attempt++) {
      signal.throwIfAborted();
      try {
        const response = await this.fetch(`https://${setup.hostname}/`, { redirect: 'manual', signal: timeout(signal, 5000), headers: { 'cache-control': 'no-cache' } });
        await response.body?.cancel();
        const location = response.headers.get('location');
        if ([301, 302, 303, 307, 308].includes(response.status) && location) {
          const destination = new URL(location, `https://${setup.hostname}`);
          if (destination.protocol === 'https:' && destination.hostname === setup.teamDomain && destination.pathname.startsWith('/cdn-cgi/access/')) return;
        }
        if ([401, 403].includes(response.status) && response.headers.get('x-dsh-cf-gate') === this.store.state.instanceId) return;
        if (response.status >= 200 && response.status < 300) throw new CfError('UNPROTECTED', 'The unauthenticated URL returned success, not a verified Access rejection. Publication was stopped.');
      } catch (e) { if (e instanceof CfError || signal.aborted) throw e; }
      await pause(1500, signal);
    }
    throw new CfError('EDGE_CHECK', 'Could not verify external unauthenticated rejection. Check DNS and Access, then retry.');
  }
  onConnectorStatus(connector, status) {
    if (this.connector !== connector) return;
    this.connectorStatus = status;
    if (status === 'connected') {
      this.step('tunnel', 'done', 'Connector registered with Cloudflare');
      this.changed(); this.maybeVerified();
    } else if (status === 'error' || status === 'stopped') {
      this.connectorStatus = 'error';
      // During an operation the operation itself notices (and reports) the exit.
      if (this.operation || this.stopping || !this.published) this.changed(); else this.connectorDied();
    } else if (status === 'disconnected') {
      this.step('tunnel', 'waiting', 'Connector disconnected; cloudflared reconnects by itself'); this.changed();
    }
  }
  /** The connector ended on its own while the publication was up. Close the rest and recover with the saved token. */
  connectorDied() {
    if (this.stopping || this.disposed || !this.published) return;
    const failure = new CfError('CONNECTOR_EXIT', 'cloudflared stopped unexpectedly. The plugin reconnects automatically unless it was paused.');
    this.failure = issueOf(failure); this.step('tunnel', 'error', this.failure.message);
    // Schedule before closing so a status read never sees the stopped runtime without its retry.
    this.scheduleRetry(failure); this.changed();
    void this.closeRuntime().catch(() => {});
  }
  noteFault(event) {
    if (!this.published || this.stopping || this.disposed) return;
    if (event?.status === 'verification-unavailable') this.warning = { code: 'ACCESS_KEYS', message: 'This PC could not reach Cloudflare to check sign-ins. Requests are refused until it can; the next successful request clears this notice.' };
    else if (event?.status === 'auth-rejected') this.warning = { code: 'DSH_AUTH', message: 'DSH did not accept the session the plugin presented. The plugin requests a fresh one on the next request, so reloading the page is usually enough. The connector keeps running.' };
    else if (event?.status === 'upstream-failed') this.warning = { code: 'DSH_UPSTREAM', message: 'DSH did not answer through the tunnel. The connector is still running; the next successful request clears this notice.' };
    else return;
    this.changed();
  }
  noteHealthy() {
    if (!this.warning) return;
    this.warning = null; this.changed();
  }
  recordEvidence(kind) {
    if (this.evidence[kind]) return;
    this.evidence[kind] = true;
    if (kind === 'owner') this.step('browser', 'done', 'Signed owner identity and DSH session exchange verified');
    this.changed(); this.maybeVerified();
  }
  /** Marks the publication verified once every kind of real traffic was observed. The status itself never waits for this. */
  maybeVerified() {
    if (!this.gate || !this.published || this.verifiedThisRuntime || this.connectorStatus !== 'connected') return;
    if (!['unauthenticatedRejected', 'owner', 'http', 'api', 'websocket'].every(x => this.evidence[x])) return;
    this.verifiedThisRuntime = true;
    this.step('dsh', 'done', 'Real DSH HTTP, API, and WebSocket traffic confirmed');
    this.store.state.proven = true; this.store.state.lastVerifiedAt = new Date().toISOString();
    void this.store.save().catch(async () => { await this.closeRuntime(); this.failure = { code: 'STATE_WRITE', message: 'Verification state could not be saved. Publication was stopped.' }; this.changed(); });
    this.changed();
  }
  async refreshAndReconnect(signal) {
    const running = !!(this.gate || this.connector);
    try { await this.deps.refreshTunnelToken(this.cf(), this.store, signal); }
    catch (error) {
      if (signal.aborted || !running) throw error;
      // A frozen error cannot be marked in place. Wrap it so launch can keep the runtime.
      const wrapped = error instanceof CfError
        ? new CfError(error.code, error.message, error.details)
        : new CfError('INTERNAL', 'The connector token could not be refreshed. The running gate and connector were left in place.');
      wrapped.preserveRuntime = true;
      wrapped.cause = error;
      throw wrapped;
    }
    signal.throwIfAborted();
    if (this.gate && this.connector && this.binary) return this.restartConnector(signal);
    const state = this.store.state;
    if (state.setup && state.lastConfigurationCheck && !blockingPending(state) && await this.store.hasToken()) return this.start({}, signal, true);
    throw new CfError('SETUP', 'The connector token was saved, but this profile cannot reconnect yet. Finish setup from the local settings.');
  }
  async restartConnector(signal) {
    const previous = this.connector;
    if (this.operation) this.operation.rebuilding = true;
    this.step('dsh', 'waiting', 'Connector token was reread.');
    // Detach before stop so the old process exiting is not a connector failure.
    this.connector = null; this.changed();
    await previous?.stop();
    signal.throwIfAborted();
    if (this.connector || !this.binary || !this.gate) return;
    await this.assertStartTimeReadable();
    const connector = new this.deps.Connector(status => this.onConnectorStatus(connector, status));
    this.connector = connector; this.connectorStatus = 'starting';
    try {
      await this.store.assertOwnership?.();
      await connector.start(this.binary.path, join(this.store.dir, 'tunnel.token'));
      await this.rememberConnector(connector);
    }
    catch (error) {
      if (signal.aborted || error?.code === 'LOCK') throw error;
      throw new CfError('CONNECTOR_EXIT', 'cloudflared could not be started after the token refresh.');
    }
    await this.awaitConnector(connector, signal, 'cloudflared did not establish a connection after the token refresh.');
  }

  // ---- Stopping ----
  /** Stops the connector first so cloudflared never forwards traffic to a closed, re-bindable port, then closes the gate. */
  closeRuntime() {
    if (this.closingRuntime) return this.closingRuntime;
    const gate = this.gate; this.gate = null;
    const connector = this.connector; this.connector = null; this.published = false;
    const closing = Promise.resolve().then(async () => {
      try { await connector?.stop(); } finally { try { await gate?.close(); } finally { await this.store.clearConnector?.().catch(() => {}); this.adapter.invalidate(); } }
    }).finally(() => { if (this.closingRuntime === closing) this.closingRuntime = null; this.changed(); });
    this.closingRuntime = closing;
    return closing;
  }
  /**
   * Aborts the operation and the management requests in flight and waits for them. A healthy publication keeps running
   * when only a side request is cancelled; an operation that was rebuilding the runtime closes its partial runtime itself.
   */
  cancel() {
    this.cancelRetry();
    this.invalidateAuthorization();
    const operation = this.operation;
    operation?.abort.abort(new DOMException('Cancelled', 'AbortError'));
    this.forgetting?.abort.abort(new DOMException('Cancelled', 'AbortError'));
    return Promise.allSettled([operation?.promise, this.forgetting?.promise, ...[...this.requests].map(request => request.promise)]).then(() => this.changed());
  }
  /** Stops everything this controller runs. Only an explicit pause persists the stopped preference. */
  shutdown({ pause = false } = {}) {
    if (this.stopping) return this.stopping;
    this.cancelRetry();
    const stopping = Promise.resolve().then(async () => {
      await this.cancel();
      // Drain setup/resume first, then persist the pause before releasing the shutdown lock.
      // Even a failed save must stop publication.
      try { if (pause && this.store.state.setup) await this.setPaused(true); }
      finally { await this.closeRuntime(); }
      this.evidence = {}; this.warning = null; this.failure = null; this.steps = freshSteps();
      this.step('tunnel', 'idle', 'Stopped locally; Cloudflare resources are retained'); this.changed();
    }).finally(() => { if (this.stopping === stopping) this.stopping = null; this.changed(); });
    this.stopping = stopping; this.changed();
    return stopping;
  }
  /** The user's pause: stop, and remember it so a DSH restart does not reconnect. The auto-connect preference is unchanged. */
  pauseNow() { return this.shutdown({ pause: true }); }
  async dispose() {
    this.disposed = true;
    // Always release profile ownership, even if stopping the runtime fails, so a reload can reopen it.
    try { await this.shutdown(); } finally { this.clearGrant(); await this.store.close(); }
  }
}

/** Serves status and a clear reason when the profile state cannot be opened. It never writes state. */
export class UnavailableController {
  constructor(error) {
    this.generation = randomUUID(); this.failure = issueOf(error);
    if (error?.code === 'STATE_CORRUPT') this.failure = { ...this.failure, message: 'The saved plugin state could not be read, so nothing was changed. Inspect .dsh-cf/state.json in the profile directory (keep a copy), fix or move it aside, then reload DSH.', action: 'inspect-state' };
    else if (error?.code === 'LOCK') this.failure = { ...this.failure, action: 'close-other-dsh' };
  }
  async handle(endpoint, payload = {}, { management = false } = {}) {
    if (endpoint !== 'status') {
      demand(management === true, 'MANAGEMENT', 'Management is local only.');
      throw new CfError(this.failure.code, this.failure.message);
    }
    const base = { generation: this.generation, sequence: 0, version: VERSION, canManage: management === true, status: 'error' };
    if (management !== true) return { ...base, issue: { code: this.failure.code, message: this.failure.message }, publicUrl: null, verified: false, lastVerifiedAt: null, autoConnect: false, paused: false };
    return { ...base, issue: this.failure, busy: false, operation: null, progress: freshSteps(), setup: null, resources: {}, autoConnect: false, paused: false, verified: false, lastVerifiedAt: null, lastConfigurationCheck: null, hostReview: null, pendingWrite: null, authorization: { active: false, until: null }, accounts: [], account: null, publicUrl: null, enrollmentUrl: null, connector: { status: 'stopped', binary: null, download: null }, evidence: { unauthenticatedRejected: false, owner: false, http: false, api: false, websocket: false }, gatePort: 0, trustedHostLeft: null, labels: null };
  }
  bootResume() { return false; }
  async dispose() {}
}
