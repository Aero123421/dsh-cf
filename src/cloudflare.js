import { CfError, demand, hostname, email, cfId, issuer, boundedJson, timeout, digest } from './common.js';
import { parseConnectorToken } from './store.js';

const API = 'https://api.cloudflare.com/client/v4';
const PER_PAGE = 50;
export const ACCESS_SESSION_DURATION = '168h';
const MFA = { mfa_disabled: false, allowed_authenticators: ['biometrics', 'security_key'], session_duration: '1h' };
// Older saved setups have no flag and must retain their WebAuthn requirement.
export const requiresWebAuthn = setup => setup.requireWebAuthn !== false;
// Access-only apps are created without mfa_config. Switching an existing app back to Access-only sends an explicit disable.
// How Cloudflare reports "no application MFA" (absent, null or mfa_disabled: true) needs confirmation against a live account.
const createMfa = setup => requiresWebAuthn(setup) ? { mfa_config: MFA } : {};
const updateMfa = setup => ({ mfa_config: requiresWebAuthn(setup) ? MFA : { mfa_disabled: true } });
const accessOnlyMfa = config => config == null || (typeof config === 'object' && !Array.isArray(config) && config.mfa_disabled === true);
const webAuthnMfa = config => config?.mfa_disabled === false && exact([...(config.allowed_authenticators ?? [])].sort(), ['biometrics', 'security_key']);
const appHasMode = (app, setup) => requiresWebAuthn(setup) ? webAuthnMfa(app.mfa_config) : accessOnlyMfa(app.mfa_config);
/** Checkpoints that older versions recorded for idempotent PUTs. They no longer block resume. */
export const isLegacyCheckpoint = pending => pending?.kind === 'session' || pending?.kind === 'authentication';
export const blockingPending = state => !!state.pending && !isLegacyCheckpoint(state.pending);
/** A mismatch found while reading Cloudflare means the saved check no longer proves the configuration. */
export const invalidatesConfiguration = error => error instanceof CfError && (/^(?:ACCESS|IDP|TUNNEL|DNS|MFA|POLICY|SESSION)_CHANGED$/.test(error.code) || ['MFA_IDP_SUBSTITUTE', 'MFA_UNKNOWN', 'DNS_CONFLICT', 'ACCESS_CONFLICT'].includes(error.code));
const DURATION = /^(?:0|[1-9]\d*)[mh]$/;
/**
 * The organization API exposes AMR matching as optional duration configuration.
 * An omitted/null duration is unset; unlike a duration of 0m, it does not enable
 * IdP MFA substitution. Also honor the Access guide's explicit flag and alias.
 * Require a recognizable MFA configuration before interpreting absent AMR fields.
 * https://developers.cloudflare.com/api/resources/zero_trust/subresources/organizations/methods/list/
 */
export function mfaAssurance(organization) {
  const config = organization?.mfa_config;
  const missing = ['biometrics', 'security_key'];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { state: 'unknown', missing };
  if (config.allowed_authenticators != null && !Array.isArray(config.allowed_authenticators)) return { state: 'unknown', missing };
  const allowed = config.allowed_authenticators ?? [];
  if (allowed.some(item => typeof item !== 'string')) return { state: 'unknown', missing };
  const absent = missing.filter(item => !allowed.includes(item));
  const duration = value => value == null ? 'absent' : typeof value === 'string' && DURATION.test(value) ? 'set' : 'bad';
  const enabled = config.amr_matching_enabled;
  const apiDuration = duration(config.amr_matching_session_duration);
  const guideDuration = duration(config.amr_session_duration);
  if ((enabled != null && typeof enabled !== 'boolean') || apiDuration === 'bad' || guideDuration === 'bad') return { state: 'unknown', missing: absent };
  if (enabled === true || apiDuration === 'set' || guideDuration === 'set') return { state: 'substitute', missing: absent };
  if (enabled == null && apiDuration === 'absent' && guideDuration === 'absent') {
    const recognizable = Array.isArray(config.allowed_authenticators) && typeof config.session_duration === 'string' && DURATION.test(config.session_duration);
    if (!recognizable) return { state: 'unknown', missing: absent };
  }
  return { state: 'independent', missing: absent };
}
function demandIndependentMfa(assurance) {
  demand(assurance.state === 'independent', assurance.state === 'substitute' ? 'MFA_IDP_SUBSTITUTE' : 'MFA_UNKNOWN', assurance.state === 'substitute'
    ? 'This organization lets identity-provider MFA replace the independent WebAuthn prompt. Turn off “Use identity provider MFA” in the Zero Trust Access settings, then reload. This plugin does not change that shared setting.'
    : 'The organization response did not show whether identity-provider MFA can replace independent WebAuthn. Reload the account before publishing. Nothing was changed.');
}
const id = value => encodeURIComponent(value);
function httpMessage(status) {
  if (status === 401 || status === 403) return `Cloudflare refused the request (HTTP ${status}). Check the API token's permissions and that it covers the selected account and zone.`;
  if (status === 404) return 'Cloudflare reported that the resource does not exist (HTTP 404). Check the selected account, zone and saved resources.';
  if (status === 429) return 'Cloudflare is rate limiting this token (HTTP 429). Wait a minute and retry.';
  return `Cloudflare API returned HTTP ${status}. Check the selected resources and token permissions.`;
}
const exact = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export class Cloudflare {
  constructor(token, fetchImpl = fetch) { demand(typeof token === 'string' && token.length >= 20 && !/\s/.test(token), 'API_TOKEN', 'Enter an API token, not a Global API key.'); this.token = token; this.fetch = fetchImpl; }
  async call(method, path, body, signal) {
    signal?.throwIfAborted();
    demand(path.startsWith('/') && !path.startsWith('//'), 'API_PATH', 'Invalid Cloudflare API path.');
    let response;
    try { response = await this.fetch(API + path, { method, redirect: 'error', signal: timeout(signal), headers: { Authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch (e) {
      if (signal?.aborted) throw e;
      // Only a create (POST) is recorded as a pending write; PUT/DELETE here are idempotent and safe to retry.
      throw new CfError('CF_NETWORK', method === 'GET'
        ? 'Cloudflare did not respond. Check this computer’s connection to api.cloudflare.com and retry.'
        : method === 'POST'
          ? 'Cloudflare did not return a response. A recorded write may need reconciliation before retrying.'
          : 'Cloudflare did not respond, so the change may or may not have been applied. Check connectivity and retry.');
    }
    // The HTTP status decides the outcome before any body is read: a non-JSON 4xx is still a definitive rejection.
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      signal?.throwIfAborted();
      throw new CfError(`CF_${response.status}`, httpMessage(response.status));
    }
    const data = await boundedJson(response);
    signal?.throwIfAborted();
    demand(data?.success === true, `CF_${response.status}`, httpMessage(response.status));
    return data;
  }
  async get(path, signal) { return (await this.call('GET', path, undefined, signal)).result; }
  async list(path, signal) {
    const out = [];
    for (let page = 1; page <= 100; page++) {
      // 50 is the documented maximum for /accounts and /zones and is valid for every list used here.
      const data = await this.call('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=${PER_PAGE}&page=${page}`, undefined, signal);
      demand(Array.isArray(data.result), 'CF_LIST', 'Cloudflare returned an invalid resource list.');
      out.push(...data.result);
      const total = data.result_info?.total_pages;
      if (Number.isInteger(total) && total > 0 ? page >= total : data.result.length < PER_PAGE) return out;
    }
    throw new CfError('CF_LIST', 'Resource list exceeded the bounded pagination limit.');
  }
  async accounts(signal) { return (await this.list('/accounts', signal)).map(a => ({ id: a.id, name: a.name })); }
  async account(accountId, signal) {
    cfId(accountId);
    const [zones, organization, idps] = await Promise.all([
      this.list(`/zones?account.id=${id(accountId)}`, signal),
      this.get(`/accounts/${id(accountId)}/access/organizations`, signal).catch(error => {
        if (error?.code === 'CF_404') throw new CfError('NO_ZERO_TRUST', 'This account has no Cloudflare One (Zero Trust) organization yet. Open Zero Trust in the Cloudflare dashboard, finish the first-time setup (it asks for a team name), then reload the account here.');
        throw error;
      }),
      this.list(`/accounts/${id(accountId)}/access/identity_providers`, signal),
    ]);
    demand(idps.length > 0, 'NO_IDP', 'This account has no Access login method. In Zero Trust open Settings > Authentication, add a login method (for example One-time PIN), then reload the account here.');
    issuer(organization.auth_domain);
    const assurance = mfaAssurance(organization);
    return {
      zones: zones.filter(z => z.account?.id === accountId && z.status === 'active').map(z => ({ id: z.id, name: z.name })),
      teamDomain: organization.auth_domain,
      idps: idps.map(p => ({ id: p.id, name: p.name, type: p.type })),
      mfa: assurance.state,
      mfaMissing: assurance.missing,
      organizationRevision: digest(JSON.stringify(organization)),
    };
  }
  async enableMfa(accountId, revision, signal) {
    cfId(accountId);
    const path = `/accounts/${id(accountId)}/access/organizations`;
    const current = await this.get(path, signal);
    demand(digest(JSON.stringify(current)) === revision, 'ORG_CHANGED', 'Shared Access settings changed. Reload and review the change again.');
    const next = { ...current, mfa_config: { ...current.mfa_config, allowed_authenticators: [...new Set([...(current.mfa_config?.allowed_authenticators ?? []), 'biometrics', 'security_key'])], session_duration: current.mfa_config?.session_duration ?? '1h' } };
    // Do not change mfa_required_for_all_apps or an IdP-MFA shortcut; this is an explicit additive change.
    await this.call('PUT', path, next, signal);
    return this.account(accountId, signal);
  }
  async validateSetup(input, signal) {
    const setup = { accountId: cfId(input.accountId), zoneId: cfId(input.zoneId), hostname: hostname(input.hostname), ownerEmail: email(input.ownerEmail), idpId: input.idpId };
    demand(input.requireWebAuthn === undefined || typeof input.requireWebAuthn === 'boolean', 'MFA_MODE', 'Choose whether additional WebAuthn is required.');
    if (input.requireWebAuthn !== undefined) setup.requireWebAuthn = input.requireWebAuthn;
    demand(typeof setup.idpId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(setup.idpId), 'IDP', 'Choose one existing Access identity provider.');
    const [zone, account] = await Promise.all([this.get(`/zones/${id(setup.zoneId)}`, signal), this.account(setup.accountId, signal)]);
    demand(zone.account?.id === setup.accountId && zone.status === 'active', 'ZONE', 'Select an active DNS zone belonging to this account.');
    demand(setup.hostname.endsWith(`.${zone.name}`), 'ZONE', 'Use a dedicated subdomain inside the selected zone, not its apex.');
    // Cloudflare's free Universal SSL certificate covers *.zone only, so a deeper name would not get a valid certificate.
    demand(!setup.hostname.slice(0, -(zone.name.length + 1)).includes('.'), 'HOSTNAME_DEPTH', `Use exactly one label in front of ${zone.name}, for example dsh.${zone.name}. Deeper names such as a.b.${zone.name} are not covered by Cloudflare's free certificate.`);
    demand(account.idps.some(x => x.id === setup.idpId), 'IDP', 'The identity provider does not belong to this account.');
    if (requiresWebAuthn(setup)) {
      demandIndependentMfa({ state: account.mfa, missing: account.mfaMissing });
      demand(account.mfaMissing.length === 0, 'MFA_REQUIRED', 'Enable biometrics and security keys in Access first, using the reviewed shared-settings action.');
    }
    setup.teamDomain = account.teamDomain; return setup;
  }
}
function overlaps(domain, host) {
  if (!domain) return false;
  const name = String(domain).replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  return name === host || (name.startsWith('*.') && host.endsWith(name.slice(1)));
}
export async function validateAccess(cf, setup, owned, instanceId, signal) {
  const base = `/accounts/${id(setup.accountId)}/access/apps/${id(owned.appId)}`;
  const [organization, app, policies] = await Promise.all([
    requiresWebAuthn(setup) ? cf.get(`/accounts/${id(setup.accountId)}/access/organizations`, signal) : null,
    cf.get(base, signal),
    cf.list(`${base}/policies`, signal),
  ]);
  if (requiresWebAuthn(setup)) demandIndependentMfa(mfaAssurance(organization));
  demand(app.name === `dsh-cf-${instanceId}` && app.domain === setup.hostname && app.type === 'self_hosted' && /^[a-f0-9]{64}$/i.test(app.aud), 'ACCESS_CHANGED', 'The owned Access application no longer matches this instance.');
  demand(!owned.audience || app.aud === owned.audience, 'ACCESS_CHANGED', 'The Access audience changed. Re-enrollment is required.');
  if (requiresWebAuthn(setup)) demand(webAuthnMfa(app.mfa_config), 'MFA_CHANGED', 'The application must require WebAuthn biometrics/security keys only.');
  else demand(accessOnlyMfa(app.mfa_config), 'MFA_CHANGED', 'The application no longer matches the selected Access sign-in mode.');
  demand(app.allowed_idps?.length === 1 && app.allowed_idps[0] === setup.idpId, 'IDP_CHANGED', 'The Access identity-provider restriction changed.');
  demand(policies.length === 1, 'POLICY_CHANGED', 'Unexpected Access policies. No automatic overwrite was attempted.');
  const policy = policies[0];
  if (policy.mfa_config) demand(requiresWebAuthn(setup)
    ? policy.mfa_config.mfa_disabled === false && exact([...(policy.mfa_config.allowed_authenticators ?? [])].sort(), ['biometrics', 'security_key'])
    : policy.mfa_config.mfa_disabled === true, 'MFA_CHANGED', 'A policy override changed the selected authentication mode. It was not overwritten.');
  demand(policy.decision === 'allow' && policy.include?.length === 1 && policy.include[0].email?.email?.toLowerCase() === setup.ownerEmail && !(policy.require?.length) && !(policy.exclude?.length), 'POLICY_CHANGED', 'The Access policy is not the expected owner-only policy.');
  demand(!app.destinations?.some(d => d.overrides?.some(o => o.behavior === 'public')), 'POLICY_CHANGED', 'Public Access bypass overrides are not supported.');
  return app;
}

/** Read the current token for the owned Tunnel and replace the local file only after the value is valid. */
export async function refreshTunnelToken(cf, store, signal) {
  const { setup, owned, instanceId } = store.state;
  demand(setup?.accountId && owned?.tunnelId, 'SETUP', 'Save this instance’s Tunnel before refreshing its connector token.');
  const tunnelPath = `/accounts/${id(setup.accountId)}/cfd_tunnel/${id(owned.tunnelId)}`;
  const tunnel = await cf.get(tunnelPath, signal);
  demand(tunnel?.name === `dsh-cf-${instanceId}` && !tunnel.deleted_at, 'TUNNEL_CHANGED', 'The stored Tunnel ID no longer belongs to this instance.');
  const token = await cf.get(`${tunnelPath}/token`, signal);
  signal?.throwIfAborted();
  const raw = typeof token === 'string' ? token : token?.token;
  await store.writeToken(acceptedConnectorToken(raw, setup.accountId, owned.tunnelId));
}
function acceptedConnectorToken(raw, accountId, tunnelId) {
  const parsed = parseConnectorToken(raw);
  demand(parsed && parsed.accountId === accountId && parsed.tunnelId === String(tunnelId).toLowerCase(), 'TOKEN', 'Cloudflare returned an invalid connector token.');
  return raw;
}
/** Durable checkpoints record our IDs; a lost POST result is never silently retried. */
export function assertSetupChange(previous, next, owned) {
  // Until Cloudflare holds a resource of ours, nothing depends on these fields: a failed first attempt can be corrected.
  if (!previous || !(owned.appId || owned.tunnelId || owned.dnsId)) return;
  const { requireWebAuthn: _previousMode, ...before } = previous;
  const { requireWebAuthn: _nextMode, ...after } = next;
  demand(exact(before, after), 'SETUP_CHANGED', 'Remove this instance’s existing public configuration before changing its account, hostname, owner, or IdP.');
  if (requiresWebAuthn(previous) !== requiresWebAuthn(next)) demand(owned.appId, 'SETUP_CHANGED', 'Finish or remove the existing setup before changing its authentication mode.');
}

const POST_KINDS = { access: 'access', authentication: 'access', session: 'access', tunnel: 'tunnel', dns: 'dns' };
/** Exact marker matches for the saved checkpoint. Reads only. The saved `pending.path` is never a request target. */
async function scanPending(cf, store, signal) {
  const { pending, setup, owned, instanceId } = store.state;
  demand(pending && setup, 'WRITE_UNKNOWN', 'There is no saved write to inspect.');
  const accountId = cfId(setup.accountId), zoneId = cfId(setup.zoneId);
  const marker = `dsh-cf-${instanceId}`, host = hostname(setup.hostname);
  demand(pending.marker === marker, 'WRITE_UNKNOWN', 'The saved write marker does not match this instance.');
  const type = POST_KINDS[pending.kind];
  demand(type, 'WRITE_UNKNOWN', 'This write needs manual inspection using the recovery guide.');
  let resources, expectedId;
  if (type === 'access') {
    resources = (await cf.list(`/accounts/${id(accountId)}/access/apps`, signal)).filter(app => app.name === marker && app.domain === host);
    expectedId = owned.appId;
  } else if (type === 'tunnel') {
    resources = (await cf.list(`/accounts/${id(accountId)}/cfd_tunnel`, signal)).filter(tunnel => tunnel.name === marker && !tunnel.deleted_at);
    expectedId = owned.tunnelId;
  } else {
    resources = (await cf.list(`/zones/${id(zoneId)}/dns_records?name=${id(host)}`, signal)).filter(record => record.name === host && record.comment === marker && record.type === 'CNAME');
    expectedId = owned.dnsId;
  }
  signal?.throwIfAborted();
  const matches = resources.filter(item => typeof item.id === 'string').map(item => ({ id: item.id, recorded: item.id === expectedId }));
  return { type, accountId, zoneId, marker, host, matches, report: { kind: pending.kind, at: pending.at, marker, hostname: host, status: matches.length === 0 ? 'not-found' : matches.length === 1 && (!expectedId || matches[0].recorded) ? 'found' : 'ambiguous', matches: matches.slice(0, 10) } };
}
/** Read-only reconciliation aid. Never adopts, deletes, clears a checkpoint, or repeats a write. */
export async function inspectPending(cf, store, signal) { return (await scanPending(cf, store, signal)).report; }

export const PENDING_MODES = ['clear-recorded', 'delete-unrecorded', 'clear-not-found'];
/**
 * Explicit recovery for an unknown POST. It inspects Cloudflare again itself and trusts neither client-supplied IDs
 * nor the saved path. It never repeats the original write and never adopts a resource.
 * - clear-recorded: every exact match is the ID this instance already recorded.
 * - delete-unrecorded: delete only exact marker matches that are not the recorded ID, then clear.
 * - clear-not-found: nothing matched. Cloudflare may still be completing the write, so this relies on the operator's confirmation.
 */
export async function resolvePending(cf, store, mode, signal) {
  demand(PENDING_MODES.includes(mode), 'PAYLOAD', 'Choose one of the listed recovery actions.');
  const scan = await scanPending(cf, store, signal);
  const { matches } = scan, unrecorded = matches.filter(m => !m.recorded);
  const deleted = [];
  if (mode === 'clear-recorded') demand(matches.length > 0 && unrecorded.length === 0, 'WRITE_MISMATCH', 'Cloudflare holds a matching resource that this instance did not record. Choose the delete option after reviewing it, or keep the checkpoint.');
  else if (mode === 'clear-not-found') demand(matches.length === 0, 'WRITE_MISMATCH', 'Cloudflare holds a matching resource. Clear the checkpoint only after handling it.');
  else {
    demand(unrecorded.length > 0, 'WRITE_MISMATCH', 'There is no unrecorded resource to delete.');
    for (const match of unrecorded) {
      signal?.throwIfAborted();
      if (await deleteMarked(cf, scan, match.id, signal)) deleted.push({ type: scan.type, id: match.id });
    }
  }
  signal?.throwIfAborted();
  store.state.pending = null; await store.save();
  return { mode, cleared: true, deleted, inspection: scan.report };
}
/** Re-read one resource by ID, require this instance's marker again, then delete it. A resource that is already gone counts as done. */
async function deleteMarked(cf, scan, resourceId, signal) {
  const { type, accountId, zoneId, marker, host } = scan;
  const path = type === 'access' ? `/accounts/${id(accountId)}/access/apps/${id(resourceId)}`
    : type === 'tunnel' ? `/accounts/${id(accountId)}/cfd_tunnel/${id(resourceId)}` : `/zones/${id(zoneId)}/dns_records/${id(resourceId)}`;
  let item; try { item = await cf.get(path, signal); } catch (e) { if (e.code === 'CF_404') return false; throw e; }
  const ours = type === 'access' ? item?.name === marker && item.domain === host
    : type === 'tunnel' ? item?.name === marker && !item.deleted_at
      : item?.name === host && item.comment === marker && item.type === 'CNAME';
  demand(ours, 'WRITE_MISMATCH', 'A resource no longer matches this instance’s marker. Nothing was deleted.');
  if (type === 'tunnel') {
    try { await cf.call('DELETE', `${path}/connections`, undefined, signal); }
    catch (e) { if (e.code !== 'CF_404') throw e; }
  }
  await cf.call('DELETE', path, undefined, signal);
  return true;
}

const sameRule = (rule, want, wantService) => rule?.hostname === want.hostname && (wantService === undefined || rule.service === wantService)
  && rule.originRequest?.access?.required === true && rule.originRequest.access.teamName === want.originRequest.access.teamName && exact(rule.originRequest.access.audTag, want.originRequest.access.audTag);
const defaultRule = rule => rule?.service === 'http_status:404';
/** 'match' needs no write, 'write' is a first-time or port-only change to an owned Tunnel, 'other' is somebody else's routing. */
function ingressVerdict(rules, desired) {
  const [wanted] = desired;
  if (rules?.length === 2 && sameRule(rules[0], wanted, wanted.service) && defaultRule(rules[1])) return 'match';
  if (!rules?.length || (rules.length === 1 && defaultRule(rules[0]) && !rules[0].hostname)) return 'write';
  if (rules.length === 2 && sameRule(rules[0], wanted) && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(rules[0].service) && defaultRule(rules[1])) return 'write';
  return 'other';
}
const TUNNEL_MISMATCH = 'The owned Tunnel routing does not match the expected configuration. Publication was stopped.';

/**
 * Idempotent PUT of the application's session duration and, for a mode change, its MFA setting.
 * It records no checkpoint. After a failure the application is read again: equal to the target is success,
 * equal to the previous values is an ordinary error, anything else means somebody else changed it.
 */
async function updateApp(cf, store, setup, gatePath, beforeWrite, signal) {
  const s = store.state, owned = s.owned;
  const legacy = isLegacyCheckpoint(s.pending);
  let validated = s.setup, app;
  try { app = await validateAccess(cf, validated, owned, s.instanceId, signal); }
  catch (error) {
    // A previous PUT may have landed before readback failed. Accept only the explicitly requested
    // target mode after rechecking ownership, audience, IdP and every policy; never infer another mode.
    if (!(error.code === 'MFA_CHANGED' && requiresWebAuthn(s.setup) !== requiresWebAuthn(setup))) throw error;
    validated = setup; app = await validateAccess(cf, validated, owned, s.instanceId, signal);
  }
  if (legacy) { s.pending = null; await store.save(); }
  const modeChanged = requiresWebAuthn(s.setup) !== requiresWebAuthn(setup);
  const mfaWrite = requiresWebAuthn(validated) !== requiresWebAuthn(setup);
  if (mfaWrite || app.session_duration !== ACCESS_SESSION_DURATION) {
    const policies = await cf.list(`${gatePath}/policies`, signal);
    if (mfaWrite) demand(policies.every(policy => !policy.mfa_config), 'MFA_CHANGED', 'An existing policy overrides MFA. It was not changed automatically.');
    demand(policies.every(policy => !policy.session_duration || policy.session_duration === ACCESS_SESSION_DURATION), 'SESSION_CHANGED', 'An existing policy overrides the session duration. Review that policy before changing the application session.');
    await beforeWrite();
    try { await cf.call('PUT', gatePath, { ...app, session_duration: ACCESS_SESSION_DURATION, ...(mfaWrite ? updateMfa(setup) : {}) }, signal); }
    catch (error) {
      if (signal?.aborted || !(error instanceof CfError) || /^CF_4\d\d$/.test(error.code)) throw error;
      let now; try { now = await cf.get(gatePath, signal); } catch { throw error; }
      const isTarget = now.session_duration === ACCESS_SESSION_DURATION && (!mfaWrite || appHasMode(now, setup));
      const isPrevious = now.session_duration === app.session_duration && (!mfaWrite || appHasMode(now, validated));
      if (!isTarget) {
        if (isPrevious) throw error;
        throw new CfError('ACCESS_CHANGED', 'The Access application changed while it was being updated. Nothing else was written; review it in Cloudflare.');
      }
    }
    const updated = await validateAccess(cf, setup, owned, s.instanceId, signal);
    demand(updated.session_duration === ACCESS_SESSION_DURATION, 'SESSION_CHANGED', 'Cloudflare did not return the requested one-week session duration.');
  }
  if (modeChanged) {
    // Only a mode change makes the earlier traffic checks void. A session-duration update keeps them.
    s.setup = setup; s.proven = false; s.autoConnect = false; s.lastVerifiedAt = null; s.lastConfigurationCheck = null; await store.save();
  }
}

export async function provision(cf, store, setup, gatePort, signal, progress = () => {}) {
  const s = store.state; const owned = s.owned; const marker = `dsh-cf-${s.instanceId}`;
  demand(!blockingPending(s), 'WRITE_UNKNOWN', 'A previous Cloudflare write has an unknown result. Inspect the pending record and Cloudflare resources before retrying; no duplicate was created.');
  // The earlier configuration check stays valid across reads. It is voided right before the first write that could change it.
  const beforeWrite = async () => {
    signal?.throwIfAborted();
    if (s.lastConfigurationCheck != null) { s.lastConfigurationCheck = null; await store.save(); }
  };
  if (s.setup) {
    assertSetupChange(s.setup, setup, owned);
    if (owned.appId) await updateApp(cf, store, setup, `/accounts/${id(setup.accountId)}/access/apps/${id(owned.appId)}`, beforeWrite, signal);
  }
  const [records, apps] = await Promise.all([
    cf.list(`/zones/${id(setup.zoneId)}/dns_records?name=${id(setup.hostname)}`, signal),
    cf.list(`/accounts/${id(setup.accountId)}/access/apps`, signal),
  ]);
  demand(records.every(r => r.id === owned.dnsId), 'DNS_CONFLICT', 'This hostname already has a DNS record not owned by this plugin. It was not changed.');
  demand(apps.every(a => a.id === owned.appId || (!overlaps(a.domain, setup.hostname) && !a.destinations?.some(d => overlaps(d.uri, setup.hostname)))), 'ACCESS_CONFLICT', 'An existing Access application overlaps this hostname. Choose another hostname.');
  s.setup = setup; s.gatePort = gatePort; await store.save();
  const writeNew = async (kind, path, body, commit) => {
    await beforeWrite();
    s.pending = { kind, path, marker, at: new Date().toISOString() }; await store.save();
    let data;
    try { data = (await cf.call('POST', path, body, signal)).result; }
    catch (e) {
      // Definitive validation/auth errors did not create a resource; transport/5xx errors remain uncertain.
      if (e instanceof CfError && /^CF_4\d\d$/.test(e.code)) { s.pending = null; await store.save(); }
      throw e;
    }
    await commit(data); s.pending = null; await store.save();
  };
  progress('access');
  if (!owned.appId) {
    await writeNew('access', `/accounts/${id(setup.accountId)}/access/apps`, {
      name: marker, type: 'self_hosted', domain: setup.hostname, allowed_idps: [setup.idpId], session_duration: ACCESS_SESSION_DURATION, ...createMfa(setup),
      policies: [{ name: `${marker}-owner`, decision: 'allow', precedence: 1, include: [{ email: { email: setup.ownerEmail } }], require: [], exclude: [] }],
    }, async app => { demand(typeof app?.id === 'string', 'CF_CREATE', 'Cloudflare returned no Access application ID.'); owned.appId = app.id; });
  }
  const app = await validateAccess(cf, setup, owned, s.instanceId, signal);
  demand(app.session_duration === ACCESS_SESSION_DURATION, 'SESSION_CHANGED', 'Cloudflare did not return the requested one-week session duration.');
  const sessionPolicies = await cf.list(`/accounts/${id(setup.accountId)}/access/apps/${id(owned.appId)}/policies`, signal);
  demand(sessionPolicies.every(policy => !policy.session_duration || policy.session_duration === ACCESS_SESSION_DURATION), 'SESSION_CHANGED', 'An existing policy overrides the one-week application session.');
  owned.audience = app.aud; await store.save();
  progress('tunnel');
  if (!owned.tunnelId) {
    await writeNew('tunnel', `/accounts/${id(setup.accountId)}/cfd_tunnel`, { name: marker, config_src: 'cloudflare' }, async tunnel => {
      demand(typeof tunnel?.id === 'string', 'CF_CREATE', 'Cloudflare returned no Tunnel ID.'); owned.tunnelId = tunnel.id;
      if (tunnel.token) await store.writeToken(acceptedConnectorToken(tunnel.token, setup.accountId, tunnel.id));
    });
  }
  const tunnelPath = `/accounts/${id(setup.accountId)}/cfd_tunnel/${id(owned.tunnelId)}`;
  const tunnel = await cf.get(tunnelPath, signal);
  demand(tunnel.name === marker && !tunnel.deleted_at, 'TUNNEL_CHANGED', 'The stored Tunnel ID no longer belongs to this instance.');
  const desired = { config: { ingress: [ { hostname: setup.hostname, service: `http://127.0.0.1:${gatePort}`, originRequest: { access: { required: true, teamName: setup.teamDomain.replace('.cloudflareaccess.com', ''), audTag: [owned.audience] } } }, { service: 'http_status:404' } ] } };
  // The Tunnel is ours (marker verified above). Write routing only for a first-time or port-only difference.
  const current = await cf.get(`${tunnelPath}/configurations`, signal);
  const verdict = ingressVerdict(current?.config?.ingress, desired.config.ingress);
  demand(verdict !== 'other', 'TUNNEL_CHANGED', TUNNEL_MISMATCH);
  if (verdict === 'write') {
    await beforeWrite();
    await cf.call('PUT', `${tunnelPath}/configurations`, desired, signal);
    demand(ingressVerdict((await cf.get(`${tunnelPath}/configurations`, signal))?.config?.ingress, desired.config.ingress) === 'match', 'TUNNEL_CHANGED', TUNNEL_MISMATCH);
  }
  // Re-read the current connector token after the Tunnel is confirmed as ours. A failed read does not replace the saved file.
  await refreshTunnelToken(cf, store, signal);
  progress('dns');
  if (!owned.dnsId) {
    await writeNew('dns', `/zones/${id(setup.zoneId)}/dns_records`, { type: 'CNAME', name: setup.hostname, content: `${owned.tunnelId}.cfargotunnel.com`, proxied: true, ttl: 1, comment: marker }, async record => {
      demand(typeof record?.id === 'string', 'CF_CREATE', 'Cloudflare returned no DNS record ID.'); owned.dnsId = record.id;
    });
  }
  // Keep the returned ID durable even if this read fails, so retry/cleanup never creates a duplicate.
  const record = await cf.get(`/zones/${id(setup.zoneId)}/dns_records/${id(owned.dnsId)}`, signal);
  demand(record?.name === setup.hostname && record.type === 'CNAME' && record.content === `${owned.tunnelId}.cfargotunnel.com` && record.proxied === true, 'DNS_CHANGED', 'The owned DNS record does not match the expected configuration. Publication was stopped.');
  return { ...setup, audience: owned.audience };
}
export async function removeOwned(cf, store, signal) {
  const { setup, owned, instanceId } = store.state;
  demand(!blockingPending(store.state), 'WRITE_UNKNOWN', 'Resolve the unknown write result before deleting resources.');
  if (!setup) return;
  if (store.state.pending) { store.state.pending = null; await store.save(); }
  if (owned.dnsId) {
    const path = `/zones/${id(setup.zoneId)}/dns_records/${id(owned.dnsId)}`;
    let record; try { record = await cf.get(path, signal); } catch (e) { if (e.code !== 'CF_404') throw e; }
    if (record) {
      demand(record.name === setup.hostname && record.type === 'CNAME' && record.content === `${owned.tunnelId}.cfargotunnel.com`, 'DNS_CHANGED', 'DNS ownership could not be verified; deletion stopped.');
      await cf.call('DELETE', path, undefined, signal);
    }
    delete owned.dnsId; await store.save();
  }
  if (owned.tunnelId) {
    const path = `/accounts/${id(setup.accountId)}/cfd_tunnel/${id(owned.tunnelId)}`;
    let tunnel; try { tunnel = await cf.get(path, signal); } catch (e) { if (e.code !== 'CF_404') throw e; }
    if (tunnel && !tunnel.deleted_at) {
      demand(tunnel.name === `dsh-cf-${instanceId}`, 'TUNNEL_CHANGED', 'Tunnel ownership could not be verified; deletion stopped.');
      // A Tunnel must have no active connections before deletion. Our own connector is already stopped;
      // remove the edge's stale connection records for this owned Tunnel only.
      try { await cf.call('DELETE', `${path}/connections`, undefined, signal); }
      catch (e) { if (e.code !== 'CF_404') throw e; }
      await cf.call('DELETE', path, undefined, signal);
    }
    delete owned.tunnelId; delete owned.ingressConfigured; await store.clearToken(); await store.save();
  }
  if (owned.appId) {
    const path = `/accounts/${id(setup.accountId)}/access/apps/${id(owned.appId)}`;
    let app; try { app = await cf.get(path, signal); } catch (e) { if (e.code !== 'CF_404') throw e; }
    if (app) {
      demand(app.name === `dsh-cf-${instanceId}` && app.domain === setup.hostname && (!owned.audience || app.aud === owned.audience), 'ACCESS_CHANGED', 'Access application ownership could not be verified; deletion stopped.');
      await cf.call('DELETE', path, undefined, signal);
    }
    delete owned.appId; delete owned.audience; await store.save();
  }
  store.state.setup = null; store.state.autoConnect = false; store.state.lastConfigurationCheck = null; await store.save();
}
