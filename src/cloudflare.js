import { CfError, demand, hostname, email, cfId, issuer, boundedJson, timeout, digest } from './common.js';

const API = 'https://api.cloudflare.com/client/v4';
const PER_PAGE = 50;
const MFA = { mfa_disabled: false, allowed_authenticators: ['biometrics', 'security_key'], session_duration: '1h' };
const DURATION = /^(?:0|[1-9]\d*)[mh]$/;
/**
 * Whether this organization still forces an independent WebAuthn prompt.
 * The API field is `amr_matching_session_duration`. The Access guide also returns
 * `amr_matching_enabled` and `amr_session_duration`. Any one of those means IdP MFA
 * can skip the independent prompt. Omission of all three is the optional-field default
 * (not enabled). A present value that is not a boolean or duration is unknown.
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
  return { state: 'independent', missing: absent };
}
function demandIndependentMfa(assurance) {
  demand(assurance.state === 'independent', assurance.state === 'substitute' ? 'MFA_IDP_SUBSTITUTE' : 'MFA_UNKNOWN', assurance.state === 'substitute'
    ? 'This organization lets identity-provider MFA replace the independent WebAuthn prompt. Turn off “Use identity provider MFA” in the Zero Trust Access settings, then reload. This plugin does not change that shared setting.'
    : 'The organization response did not show whether identity-provider MFA can replace independent WebAuthn. Reload the account before publishing. Nothing was changed.');
}
const id = value => encodeURIComponent(value);
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
    const data = await boundedJson(response);
    signal?.throwIfAborted();
    demand(response.ok && data.success === true, `CF_${response.status}`, `Cloudflare API returned HTTP ${response.status}. Check the selected resources and token permissions.`);
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
      this.get(`/accounts/${id(accountId)}/access/organizations`, signal),
      this.list(`/accounts/${id(accountId)}/access/identity_providers`, signal),
    ]);
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
    demand(typeof setup.idpId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(setup.idpId), 'IDP', 'Choose one existing Access identity provider.');
    const [zone, account] = await Promise.all([this.get(`/zones/${id(setup.zoneId)}`, signal), this.account(setup.accountId, signal)]);
    demand(zone.account?.id === setup.accountId && zone.status === 'active', 'ZONE', 'Select an active DNS zone belonging to this account.');
    demand(setup.hostname.endsWith(`.${zone.name}`), 'ZONE', 'Use a dedicated subdomain inside the selected zone, not its apex.');
    demand(account.idps.some(x => x.id === setup.idpId), 'IDP', 'The identity provider does not belong to this account.');
    demandIndependentMfa({ state: account.mfa, missing: account.mfaMissing });
    demand(account.mfaMissing.length === 0, 'MFA_REQUIRED', 'Enable biometrics and security keys in Access first, using the reviewed shared-settings action.');
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
    cf.get(`/accounts/${id(setup.accountId)}/access/organizations`, signal),
    cf.get(base, signal),
    cf.list(`${base}/policies`, signal),
  ]);
  demandIndependentMfa(mfaAssurance(organization));
  demand(app.name === `dsh-cf-${instanceId}` && app.domain === setup.hostname && app.type === 'self_hosted' && /^[a-f0-9]{64}$/i.test(app.aud), 'ACCESS_CHANGED', 'The owned Access application no longer matches this instance.');
  demand(!owned.audience || app.aud === owned.audience, 'ACCESS_CHANGED', 'The Access audience changed. Re-enrollment is required.');
  demand(app.mfa_config?.mfa_disabled === false && exact([...(app.mfa_config.allowed_authenticators ?? [])].sort(), ['biometrics', 'security_key']), 'MFA_CHANGED', 'The application must require WebAuthn biometrics/security keys only.');
  demand(app.allowed_idps?.length === 1 && app.allowed_idps[0] === setup.idpId, 'IDP_CHANGED', 'The Access identity-provider restriction changed.');
  demand(policies.length === 1, 'POLICY_CHANGED', 'Unexpected Access policies. No automatic overwrite was attempted.');
  const policy = policies[0];
  if (policy.mfa_config) demand(policy.mfa_config.mfa_disabled === false && exact([...(policy.mfa_config.allowed_authenticators ?? [])].sort(), ['biometrics', 'security_key']), 'MFA_CHANGED', 'A policy override weakened WebAuthn. It was not overwritten.');
  demand(policy.decision === 'allow' && policy.include?.length === 1 && policy.include[0].email?.email?.toLowerCase() === setup.ownerEmail && !(policy.require?.length) && !(policy.exclude?.length) && policy.mfa_config?.mfa_disabled !== true, 'POLICY_CHANGED', 'The Access policy is not the expected owner-only policy.');
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
  await store.writeToken(typeof token === 'string' ? token : token?.token);
}
/** Durable checkpoints record our IDs; a lost POST result is never silently retried. */
export async function provision(cf, store, setup, gatePort, signal, progress = () => {}) {
  const s = store.state; const owned = s.owned; const marker = `dsh-cf-${s.instanceId}`;
  demand(!s.pending, 'WRITE_UNKNOWN', 'A previous Cloudflare write has an unknown result. Inspect the pending record and Cloudflare resources before retrying; no duplicate was created.');
  if (s.setup) demand(exact(s.setup, setup), 'SETUP_CHANGED', 'Remove this instance’s existing public configuration before changing its account, hostname, owner, or IdP.');
  const [records, apps] = await Promise.all([
    cf.list(`/zones/${id(setup.zoneId)}/dns_records?name=${id(setup.hostname)}`, signal),
    cf.list(`/accounts/${id(setup.accountId)}/access/apps`, signal),
  ]);
  demand(records.every(r => r.id === owned.dnsId), 'DNS_CONFLICT', 'This hostname already has a DNS record not owned by this plugin. It was not changed.');
  demand(apps.every(a => a.id === owned.appId || (!overlaps(a.domain, setup.hostname) && !a.destinations?.some(d => overlaps(d.uri, setup.hostname)))), 'ACCESS_CONFLICT', 'An existing Access application overlaps this hostname. Choose another hostname.');
  s.setup = setup; s.gatePort = gatePort; await store.save();
  const writeNew = async (kind, path, body, commit) => {
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
      name: marker, type: 'self_hosted', domain: setup.hostname, allowed_idps: [setup.idpId], session_duration: '1h', mfa_config: MFA,
      policies: [{ name: `${marker}-owner`, decision: 'allow', precedence: 1, include: [{ email: { email: setup.ownerEmail } }], require: [], exclude: [] }],
    }, async app => { demand(typeof app?.id === 'string', 'CF_CREATE', 'Cloudflare returned no Access application ID.'); owned.appId = app.id; });
  }
  const app = await validateAccess(cf, setup, owned, s.instanceId, signal); owned.audience = app.aud; await store.save();
  progress('tunnel');
  if (!owned.tunnelId) {
    await writeNew('tunnel', `/accounts/${id(setup.accountId)}/cfd_tunnel`, { name: marker, config_src: 'cloudflare' }, async tunnel => {
      demand(typeof tunnel?.id === 'string', 'CF_CREATE', 'Cloudflare returned no Tunnel ID.'); owned.tunnelId = tunnel.id;
      if (tunnel.token) await store.writeToken(tunnel.token);
    });
  }
  const tunnelPath = `/accounts/${id(setup.accountId)}/cfd_tunnel/${id(owned.tunnelId)}`;
  const tunnel = await cf.get(tunnelPath, signal);
  demand(tunnel.name === marker && !tunnel.deleted_at, 'TUNNEL_CHANGED', 'The stored Tunnel ID no longer belongs to this instance.');
  const desired = { config: { ingress: [ { hostname: setup.hostname, service: `http://127.0.0.1:${gatePort}`, originRequest: { access: { required: true, teamName: setup.teamDomain.replace('.cloudflareaccess.com', ''), audTag: [owned.audience] } } }, { service: 'http_status:404' } ] } };
  if (!owned.ingressConfigured) await cf.call('PUT', `${tunnelPath}/configurations`, desired, signal);
  const existing = await cf.get(`${tunnelPath}/configurations`, signal);
  const rules = existing?.config?.ingress;
  demand(rules?.length === 2 && rules[0]?.hostname === setup.hostname && rules[0].service === desired.config.ingress[0].service && rules[0].originRequest?.access?.required === true && rules[0].originRequest.access.teamName === desired.config.ingress[0].originRequest.access.teamName && exact(rules[0].originRequest.access.audTag, [owned.audience]) && rules[1]?.service === 'http_status:404', 'TUNNEL_CHANGED', 'The owned Tunnel routing does not match the expected configuration. Publication was stopped.');
  if (!owned.ingressConfigured) { owned.ingressConfigured = true; await store.save(); }
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
  demand(!store.state.pending, 'WRITE_UNKNOWN', 'Resolve the unknown write result before deleting resources.');
  if (!setup) return;
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
  store.state.setup = null; store.state.autoConnect = false; await store.save();
}
