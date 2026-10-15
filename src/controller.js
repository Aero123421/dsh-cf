import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CfError, demand, safeError, pause, timeout } from './common.js';
import { OAuth } from './oauth.js';
import { Cloudflare, provision, removeOwned, refreshTunnelToken } from './cloudflare.js';
import { ensureBinary, Connector } from './connector.js';
import { accessVerifier } from './access.js';
import { Gate, DIAGNOSTIC_PATH } from './gate.js';

const STEP_IDS = ['environment', 'authorization', 'access', 'tunnel', 'browser', 'dsh'];
/** Host-owned workflow; panel lifetime does not own an in-flight operation. */
export class Controller {
  constructor({ store, adapter, config = {}, fetchImpl = fetch, dependencies = {} }) {
    this.store = store; this.adapter = adapter; this.config = config; this.fetch = fetchImpl;
    this.deps = { ensureBinary, Connector, accessVerifier, Gate, provision, removeOwned, refreshTunnelToken, ...dependencies };
    this.seq = 0; this.steps = STEP_IDS.map(id => ({ id, status: 'idle', message: '' }));
    this.phase = 'idle'; this.error = null; this.operation = null; this.gate = null; this.connector = null;
    this.token = null; this.tokenUntil = 0; this.grantType = null; this.accountList = []; this.accountDetails = null;
    this.authGeneration = 0; this.requests = new Set(); this.stopping = null; this.closingRuntime = null; this.forgetting = null; this.evidence = {}; this.binary = null; this.disposed = false;
    this.oauthView = { phase: 'idle', attempt: 0, expiresAt: null, failure: null }; this.oauthLink = null; this.reachability = null;
    this.oauth = new OAuth({ fetchImpl, onToken: (token, until, signal, generation) => this.authorized(token, until, 'oauth', signal, generation), onState: (status, meta) => this.noteOauth(status, meta) });
    store.onOwnershipLost = async () => {
      try { await this.stop(); }
      finally { this.phase = 'error'; this.error = { code: 'LOCK', message: 'Profile ownership was lost. Publication was stopped. Stop the other DSH before reopening this profile.' }; this.changed(); }
    };
  }
  changed() { this.seq++; }
  noteOauth(status, meta = {}) {
    const attempt = Number.isInteger(meta?.attempt) ? meta.attempt : this.oauthView.attempt;
    if (Number.isInteger(meta?.attempt) && meta.attempt < this.oauthView.attempt) return;
    const terminal = ['complete', 'denied', 'expired', 'cancelled', 'error'].includes(status);
    if (terminal) this.oauthLink = null;
    this.oauthView = { phase: status, attempt, expiresAt: status === 'waiting' || status === 'exchanging' ? meta.expiresAt ?? this.oauthView.expiresAt : null, failure: terminal && status !== 'complete' && status !== 'cancelled' ? meta.failure ?? null : null };
    // An in-flight publication owns the checklist. A rejected side attempt must not paint that step as failed.
    if (this.operation && !['waiting', 'exchanging', 'complete'].includes(status)) { this.changed(); return; }
    const step = status === 'complete' ? 'done' : status === 'waiting' || status === 'exchanging' ? 'waiting' : status === 'cancelled' ? 'idle' : 'error';
    const message = { complete: 'Cloudflare authorization completed', waiting: 'Waiting for the browser authorization', exchanging: 'Exchanging the authorization code', denied: 'Cloudflare authorization was declined', expired: 'The authorization attempt expired', cancelled: 'Cancelled', error: 'Cloudflare authorization did not complete' }[status] || status;
    this.step('authorization', step, message); this.changed();
  }
  step(id, status, message = '') {
    const step = this.steps.find(s => s.id === id); if (!step || (step.status === status && step.message === message)) return;
    Object.assign(step, { status, message }); this.changed();
  }
  cf() { demand(this.token && Date.now() < this.tokenUntil, 'AUTHORIZE', 'Authorize Cloudflare again. Management grants are intentionally not stored on disk.'); return new Cloudflare(this.token, this.fetch); }
  invalidateAuthorization() {
    this.authGeneration++;
    for (const request of this.requests) request.abort.abort(new DOMException('Cancelled', 'AbortError'));
    return this.authGeneration;
  }
  checkAuthorization(generation, signal) {
    signal.throwIfAborted();
    demand(generation === this.authGeneration, 'OAUTH_EXPIRED', 'This authorization was superseded or cancelled.');
    demand(!this.disposed && !this.stopping, 'STOPPED', 'Plugin is stopping.');
    demand(!this.operation, 'BUSY', 'Another operation is still in progress.');
  }
  request(run, generation = this.authGeneration, parentSignal) {
    const request = { abort: new AbortController(), promise: null };
    const signal = parentSignal ? AbortSignal.any([request.abort.signal, parentSignal]) : request.abort.signal;
    this.requests.add(request); this.changed();
    request.promise = Promise.resolve().then(() => {
      this.checkAuthorization(generation, signal);
      return run(signal, () => this.checkAuthorization(generation, signal));
    }).finally(() => { this.requests.delete(request); this.changed(); });
    return request.promise;
  }
  authorized(token, until, type, signal, generation) {
    let cancelled;
    if (generation === undefined) {
      generation = this.invalidateAuthorization();
      cancelled = this.oauth.cancel();
    }
    return this.request(async (signal, check) => {
      await cancelled; check();
      const cf = new Cloudflare(token, this.fetch); const accounts = await cf.accounts(signal);
      check();
      this.token = token; this.tokenUntil = until; this.grantType = type; this.accountList = accounts; this.accountDetails = null;
      this.step('authorization', 'done', 'Cloudflare API authorization verified'); this.changed(); return { accounts };
    }, generation, signal);
  }
  account(payload, enableMfa = false) {
    demand(!this.requests.size, 'BUSY', 'Another management request is still in progress.');
    const cf = this.cf();
    return this.request(async (signal, check) => {
      const details = enableMfa ? await cf.enableMfa(payload.accountId, payload.revision, signal) : await cf.account(payload.accountId, signal);
      check();
      this.accountDetails = { ...details, accountId: payload.accountId }; this.changed(); return this.accountDetails;
    });
  }
  forget(revoke) {
    this.invalidateAuthorization();
    const requests = [...this.requests].map(request => request.promise);
    const cancelled = this.oauth.cancel();
    const abort = new AbortController();
    const token = this.token, type = this.grantType, clientId = this.oauth.grantClientId;
    this.oauth.grantClientId = null;
    this.token = null; this.tokenUntil = 0; this.grantType = null; this.accountList = []; this.accountDetails = null; this.changed();
    const forgetting = { abort, promise: null };
    this.forgetting = forgetting;
    forgetting.promise = Promise.resolve().then(async () => {
      await cancelled; await Promise.allSettled(requests);
      if (revoke && type === 'oauth') await this.oauth.revoke(token, abort.signal, clientId);
      return {};
    }).finally(() => { if (this.forgetting === forgetting) this.forgetting = null; this.changed(); });
    return forgetting.promise;
  }
  snapshot() {
    const s = this.store.state;
    return {
      sequence: this.seq, operationId: this.operation?.id ?? null, busy: !!(this.operation || this.stopping || this.forgetting || this.requests.size), phase: this.phase,
      steps: this.steps.map(s => ({ ...s })), error: this.error,
      instanceId: s.instanceId, setup: s.setup, autoConnect: s.autoConnect, gatePort: s.gatePort,
      resources: { ...s.owned }, pendingWrite: s.pending ? { kind: s.pending.kind, at: s.pending.at } : null,
      authorized: !!this.token && Date.now() < this.tokenUntil, accounts: this.accountList, account: this.accountDetails,
      publicUrl: s.setup ? `https://${s.setup.hostname}/` : null,
      verificationUrl: this.gate ? `https://${this.gate.host}${DIAGNOSTIC_PATH}?challenge=${this.gate.proofNonce}` : null,
      enrollmentUrl: s.setup ? `https://${s.setup.teamDomain}/` : this.accountDetails ? `https://${this.accountDetails.teamDomain}/` : null,
      binary: this.binary, download: this.download ?? null, evidence: { ...this.evidence },
      reachability: this.reachability ? { ...this.reachability } : null, lastVerifiedAt: s.lastVerifiedAt ?? null,
      oauth: { clientId: this.config.oauthClientId || '', scopes: this.config.oauthScopes || [], callbackPort: this.config.oauthCallbackPort || 8789, phase: this.oauthView.phase, attempt: this.oauthView.attempt, expiresAt: this.oauthView.expiresAt, failure: this.oauthView.failure },
      lastConfigurationCheck: s.lastConfigurationCheck ?? null,
      hostReview: s.hostReview ?? null,
    };
  }
  hostConfirmed() {
    demand(!this.store.state.hostReview, 'HOST_REVIEW', 'This profile was last used under a different host identity. Confirm in the local settings that no other DSH uses its Tunnel before connecting.');
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
  async handle(endpoint, payload = {}) {
    demand(payload && typeof payload === 'object' && !Array.isArray(payload), 'PAYLOAD', 'Expected an object payload.');
    if (endpoint === 'status') return this.snapshot();
    demand(!this.disposed, 'STOPPED', 'Plugin is stopping.');
    if (endpoint === 'stop' || endpoint === 'cancel') { await this.stop(); return this.snapshot(); }
    demand(!this.operation && !this.stopping && !this.forgetting, 'BUSY', 'Another operation is still in progress.');
    switch (endpoint) {
      case 'authorize':
        demand(typeof payload.token === 'string' && payload.token.length <= 16_384, 'API_TOKEN', 'Invalid API token.');
        return this.authorized(payload.token.trim(), Date.now() + 60 * 60_000, 'api');
      case 'oauth/start': {
        const flow = await this.oauth.begin({ authorizationId: this.invalidateAuthorization(), clientId: payload.clientId || this.config.oauthClientId, scopes: payload.scopes || this.config.oauthScopes, port: this.config.oauthCallbackPort || 8789 });
        this.oauthLink = { attempt: flow.attempt, authorizationUrl: flow.authorizationUrl, redirectUri: flow.redirectUri, expiresAt: flow.expiresAt };
        this.changed(); return flow;
      }
      case 'oauth/finish': return this.oauth.finish(payload.redirectUrl);
      case 'oauth/cancel': {
        const attempt = await this.oauth.cancel();
        if (attempt != null) this.noteOauth('cancelled', { attempt });
        else this.step('authorization', 'idle', 'Cancelled');
        return { phase: this.oauthView.phase };
      }
      case 'oauth/attempt': return this.oauthAttempt();
      case 'token/refresh': this.hostConfirmed(); return this.launch(signal => this.refreshAndReconnect(signal));
      case 'account': return this.account(payload);
      case 'mfa/enable':
        demand(payload.approved === true, 'CONSENT', 'Review and explicitly approve the additive organization MFA change.');
        return this.account(payload, true);
      case 'start': this.hostConfirmed(); return this.launch(signal => this.start(payload, signal, false));
      case 'resume': this.hostConfirmed(); return this.launch(signal => this.start({}, signal, true));
      case 'host/confirm':
        demand(payload.approved === true, 'CONSENT', 'Confirm that no other DSH uses this profile’s Tunnel.');
        await this.store.confirmHost(); this.changed(); return {};
      case 'autoconnect':
        demand(typeof payload.enabled === 'boolean', 'PAYLOAD', 'Expected a boolean.');
        demand(!payload.enabled || this.store.state.proven === true, 'VERIFY_FIRST', 'Complete browser/API/WebSocket verification before enabling auto-connect.');
        if (payload.enabled) this.hostConfirmed();
        this.store.state.autoConnect = payload.enabled; await this.store.save(); this.changed(); return {};
      case 'forget': return this.forget(payload.revoke === true);
      case 'remove': {
        demand(payload.confirmHostname === this.store.state.setup?.hostname && !!payload.confirmHostname, 'CONFIRM_DELETE', 'Type this instance’s exact hostname to delete its public resources.');
        const cf = this.cf();
        return this.launch(async signal => {
          this.store.state.autoConnect = false; await this.store.save();
          await this.closeRuntime(); await this.deps.removeOwned(cf, this.store, signal);
          this.store.state.proven = false; await this.store.save(); this.phase = 'idle'; this.steps = STEP_IDS.map(id => ({ id, status: 'idle', message: '' })); this.changed();
        });
      }
      default: throw new CfError('ENDPOINT', 'Unknown settings action.');
    }
  }
  launch(run) {
    demand(!this.disposed, 'STOPPED', 'Plugin is stopping.');
    demand(!this.operation && !this.stopping && !this.forgetting && !this.requests.size, 'BUSY', 'An operation is already in progress.');
    const operation = { id: randomUUID(), abort: new AbortController(), promise: null };
    this.operation = operation; this.error = null; this.changed();
    operation.promise = Promise.resolve().then(() => run(operation.abort.signal)).catch(async error => {
      await this.closeRuntime();
      this.phase = operation.abort.signal.aborted ? 'stopped' : 'error';
      this.error = operation.abort.signal.aborted ? null : safeError(error);
      for (const step of this.steps) if (step.status === 'working') { step.status = operation.abort.signal.aborted ? 'idle' : 'error'; step.message = this.error?.message || 'Cancelled'; }
    }).finally(() => { if (this.operation === operation) this.operation = null; this.changed(); });
    return { operationId: operation.id };
  }
  async start(input, signal, resume) {
    await this.closeRuntime(); signal.throwIfAborted(); this.evidence = {}; this.reachability = null; this.steps = STEP_IDS.map(id => ({ id, status: 'idle', message: '' }));
    this.phase = 'configuring'; this.step('environment', 'working', 'Checking DSH and cloudflared');
    this.hostConfirmed();
    await this.dshFacts(signal);
    const s = this.store.state;
    const setup = resume ? s.setup : await this.cf().validateSetup(input, signal);
    demand(setup, 'SETUP', 'Complete initial setup first.');
    if (resume) demand(s.lastConfigurationCheck && s.owned.audience && s.owned.dnsId && !s.pending && await this.store.hasToken(), 'SETUP', 'Initial provisioning did not finish. Authorize and retry setup.');
    const selected = input.cloudflaredPath || this.config.cloudflaredPath || s.selectedBinary || '';
    this.binary = await this.deps.ensureBinary({ dir: this.store.dir, selected, allowDownload: !resume && input.allowDownload === true, signal, fetchImpl: this.fetch, onProgress: value => { this.download = value; this.changed(); } });
    this.download = null; s.selectedBinary = selected; await this.store.save();
    signal.throwIfAborted(); this.step('environment', 'done', `${this.binary.source}: ${this.binary.version}`);
    this.step('authorization', 'done', resume ? 'Saved connector token; management grant not required' : 'Selected Cloudflare resources verified');
    this.step('access', 'working', 'Applying the supported DSH Host trust configuration');
    await this.adapter.trust(setup.hostname); signal.throwIfAborted();
    const gate = new this.deps.Gate({ host: setup.hostname, instanceId: s.instanceId, adapter: this.adapter, verify: null, onEvidence: kind => { if (this.gate === gate) this.recordEvidence(kind); }, onFault: event => { if (this.gate === gate) this.noteFault(event); } });
    this.gate = gate;
    const port = await gate.start(s.gatePort || 0); s.gatePort = port; await this.store.save();
    try {
      if (!resume) {
        // A failed read-back must not be bypassed by resuming retained resource IDs.
        s.lastConfigurationCheck = null; await this.store.save();
        signal.throwIfAborted();
        await this.deps.provision(this.cf(), this.store, setup, port, signal, phase => this.step(phase === 'access' ? 'access' : 'tunnel', 'working', `Configuring ${phase}`));
        s.lastConfigurationCheck = new Date().toISOString(); await this.store.save();
      }
      gate.verify = await this.deps.accessVerifier({ ...setup, audience: s.owned.audience });
      gate.enabled = resume && s.proven === true;
      this.step('access', 'done', resume ? `Owner/JWT gate active; Cloudflare configuration last checked ${s.lastConfigurationCheck || 'during setup'}` : 'Owner-only Access and WebAuthn policy verified');
      this.step('tunnel', 'working', 'Waiting for cloudflared registration');
      const connector = new this.deps.Connector(status => this.onConnectorStatus(connector, status));
      this.connector = connector; this.connectorStatus = 'starting';
      await connector.start(this.binary.path, join(this.store.dir, 'tunnel.token'));
      const deadline = Date.now() + 60_000;
      while (this.connectorStatus !== 'connected') {
        signal.throwIfAborted();
        demand(!['error', 'stopped'].includes(this.connectorStatus) && Date.now() < deadline, 'CONNECTOR_TIMEOUT', 'cloudflared did not establish a connection. Check outbound connectivity and the connector token.');
        await pause(200, signal);
      }
      this.step('browser', 'working', 'Checking rejection without authentication');
      await this.negativeProbe(setup, signal);
      signal.throwIfAborted();
      demand(this.connector === connector && this.gate === gate && this.connectorStatus !== 'error', 'CONNECTOR_EXIT', 'cloudflared stopped during verification. Check the connector and reconnect from the local settings.');
      this.evidence.unauthenticatedRejected = true;
      this.phase = 'waiting-browser'; this.step('browser', this.evidence.owner ? 'done' : 'waiting', this.evidence.owner ? 'Signed owner identity verified' : 'Open the verification link and authenticate with Access');
      this.step('dsh', 'waiting', 'Waiting for real DSH HTTP, API, and WebSocket traffic');
      this.changed(); this.maybeReady();
    } catch (e) { await this.closeRuntime(); throw e; }
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
      if (this.phase === 'reconnecting' || this.phase === 'rechecking') {
        this.phase = 'rechecking';
        this.step('dsh', 'waiting', 'Tunnel is connected. DSH HTTP, API, and WebSocket are not confirmed for this connection yet.');
      }
      this.maybeReady();
    } else if (status === 'error' || status === 'stopped') {
      this.connectorStatus = 'error'; this.phase = 'error';
      this.error = { code: 'CONNECTOR_EXIT', message: 'cloudflared stopped unexpectedly. Check the connector and reconnect from the local settings.' };
      this.step('tunnel', 'error', this.error.message); this.changed();
      void this.closeRuntime().catch(() => {});
    } else if (status === 'disconnected') {
      this.evidence.http = false; this.evidence.api = false; this.evidence.websocket = false;
      this.reachability = { status: 'rechecking', channel: 'tunnel' };
      this.step('tunnel', 'waiting', 'Connector disconnected');
      this.step('dsh', 'waiting', 'Tunnel is down. Reconnecting does not confirm DSH traffic again.');
      if (['ready', 'degraded', 'rechecking', 'waiting-browser'].includes(this.phase)) this.phase = 'reconnecting';
      if (this.error?.code === 'DSH_UPSTREAM' || this.error?.code === 'DSH_AUTH') this.error = null;
      this.changed();
    }
  }
  noteFault(event) {
    if (!this.gate || this.stopping || this.disposed || this.phase === 'stopped' || this.phase === 'error') return;
    const channel = event?.channel === 'api' || event?.channel === 'websocket' ? event.channel : 'http';
    if (event?.status === 'websocket-closed') {
      this.evidence.websocket = false;
      this.reachability = { status: 'websocket-ended', channel: 'websocket' };
      if (this.phase === 'ready' || this.phase === 'degraded') {
        this.phase = 'rechecking';
        this.step('dsh', 'waiting', 'WebSocket ended. This is not an upstream failure; the next DSH connection confirms it again.');
      }
      this.changed(); return;
    }
    this.evidence[channel] = false;
    const rejected = event?.status === 'auth-rejected';
    this.reachability = { status: rejected ? 'auth-rejected' : 'upstream-failed', channel };
    this.phase = 'degraded';
    this.error = rejected
      ? { code: 'DSH_AUTH', message: 'DSH rejected the proxied session. Sign in again from the local settings. The connector was left running.' }
      : { code: 'DSH_UPSTREAM', message: 'DSH did not answer through the tunnel. The connector is still running; this is not a new successful check.' };
    this.step('dsh', 'error', this.error.message); this.changed();
  }
  recordEvidence(kind) {
    const failed = this.reachability?.status === 'upstream-failed' || this.reachability?.status === 'auth-rejected';
    if (this.evidence[kind] && !(failed && this.reachability.channel === kind)) return;
    this.evidence[kind] = true;
    if (failed && this.reachability.channel === kind) {
      this.reachability = { status: 'rechecking', channel: kind };
      if (this.error?.code === 'DSH_UPSTREAM' || this.error?.code === 'DSH_AUTH') this.error = null;
      if (this.phase === 'degraded') this.phase = 'rechecking';
    }
    if (kind === 'owner') this.step('browser', 'done', 'Signed owner identity and DSH session exchange verified');
    this.changed(); this.maybeReady();
  }
  maybeReady() {
    if (!this.gate || !this.evidence.unauthenticatedRejected || !['owner', 'http', 'api', 'websocket'].every(x => this.evidence[x]) || this.connectorStatus !== 'connected') return;
    if (this.reachability?.status === 'upstream-failed' || this.reachability?.status === 'auth-rejected') return;
    if (this.phase === 'error') return;
    if (this.phase === 'ready') return;
    this.phase = 'ready'; this.reachability = { status: 'ok' };
    if (this.error?.code === 'DSH_UPSTREAM' || this.error?.code === 'DSH_AUTH') this.error = null;
    this.step('dsh', 'done', 'Real DSH HTTP, API, and WebSocket traffic confirmed');
    const verifiedAt = new Date().toISOString();
    this.store.state.proven = true; this.store.state.lastVerifiedAt = verifiedAt;
    void this.store.save().catch(async () => { await this.closeRuntime(); this.phase = 'error'; this.error = { code: 'STATE_WRITE', message: 'Verification state could not be saved. Publication was stopped.' }; this.changed(); });
    this.changed();
  }
  oauthAttempt() {
    const link = this.oauthLink;
    const phase = this.oauthView.phase;
    if (!link || (phase !== 'waiting' && phase !== 'exchanging') || Date.now() >= link.expiresAt) return { phase, attempt: this.oauthView.attempt, authorizationUrl: null, redirectUri: null, expiresAt: link?.expiresAt ?? null };
    return { phase, attempt: link.attempt, authorizationUrl: link.authorizationUrl, redirectUri: link.redirectUri, expiresAt: link.expiresAt };
  }
  async refreshAndReconnect(signal) {
    await this.deps.refreshTunnelToken(this.cf(), this.store, signal);
    signal.throwIfAborted();
    if (this.gate && this.connector && this.binary) return this.restartConnector(signal);
    if (this.store.state.setup && this.store.state.lastConfigurationCheck && !this.store.state.pending && await this.store.hasToken()) return this.start({}, signal, true);
  }
  async restartConnector(signal) {
    const previous = this.connector;
    this.evidence.http = false; this.evidence.api = false; this.evidence.websocket = false;
    this.reachability = { status: 'rechecking', channel: 'tunnel' }; this.phase = 'rechecking';
    this.step('dsh', 'waiting', 'Connector token was reread. DSH traffic has not been confirmed again.');
    // Detach before stop so the old process exiting is not a connector failure.
    this.connector = null; this.changed();
    await previous?.stop();
    signal.throwIfAborted();
    if (this.connector || !this.binary || !this.gate) return;
    const connector = new this.deps.Connector(status => this.onConnectorStatus(connector, status));
    this.connector = connector; this.connectorStatus = 'starting';
    await connector.start(this.binary.path, join(this.store.dir, 'tunnel.token'));
    const deadline = Date.now() + 60_000;
    while (this.connector === connector && this.connectorStatus !== 'connected') {
      signal.throwIfAborted();
      demand(!['error', 'stopped'].includes(this.connectorStatus) && Date.now() < deadline, 'CONNECTOR_TIMEOUT', 'cloudflared did not establish a connection after the token refresh.');
      await pause(200, signal);
    }
  }
  closeRuntime() {
    if (this.closingRuntime) return this.closingRuntime;
    const gate = this.gate; this.gate = null;
    const connector = this.connector; this.connector = null;
    const closing = Promise.resolve().then(async () => {
      try { await gate?.close(); } finally { try { await connector?.stop(); } finally { this.adapter.invalidate(); } }
    }).finally(() => { if (this.closingRuntime === closing) this.closingRuntime = null; });
    this.closingRuntime = closing;
    return closing;
  }
  stop() {
    if (this.stopping) return this.stopping;
    this.oauthLink = null;
    if (['waiting', 'exchanging'].includes(this.oauthView.phase)) this.oauthView = { phase: 'cancelled', attempt: this.oauthView.attempt, expiresAt: null, failure: null };
    this.invalidateAuthorization();
    const cancelled = this.oauth.cancel();
    const operation = this.operation;
    operation?.abort.abort(new DOMException('Cancelled', 'AbortError'));
    this.forgetting?.abort.abort(new DOMException('Cancelled', 'AbortError'));
    const work = [operation?.promise, this.forgetting?.promise, ...[...this.requests].map(request => request.promise)];
    const stopping = Promise.resolve().then(async () => {
      await cancelled; await Promise.allSettled(work);
      this.oauthLink = null;
      if (['waiting', 'exchanging', 'expired', 'error', 'denied'].includes(this.oauthView.phase)) this.oauthView = { phase: 'cancelled', attempt: this.oauthView.attempt, expiresAt: null, failure: null };
      await this.closeRuntime();
      this.evidence = {}; this.reachability = null; this.phase = 'stopped';
      this.steps = STEP_IDS.map(id => ({ id, status: 'idle', message: '' }));
      this.step('tunnel', 'idle', 'Stopped locally; Cloudflare resources are retained'); this.changed();
    }).finally(() => { if (this.stopping === stopping) this.stopping = null; this.changed(); });
    this.stopping = stopping; this.changed();
    return stopping;
  }
  async dispose() {
    this.disposed = true;
    // Always release profile ownership, even if stopping the runtime fails, so a reload can reopen it.
    try { await this.stop(); } finally { this.token = null; await this.store.close(); }
  }
}
