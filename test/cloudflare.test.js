import test from 'node:test';
import assert from 'node:assert/strict';
import { Cloudflare, provision, removeOwned, validateAccess, inspectPending, resolvePending } from '../src/cloudflare.js';
import { parseConnectorToken } from '../src/store.js';
import { ACCOUNT, SETUP, AUD, TUNNEL, connectorToken, tokenSecret, fakeCloudflare, memoryStore, reply } from './helpers.js';
import { CfError, safeError } from '../src/common.js';
const make = () => { const api = fakeCloudflare(); return { ...api, cf: new Cloudflare('test-management-token-123456789', api.fetchImpl), store: memoryStore() }; };
test('unknown-write inspection matches exact markers and never writes, adopts or clears a checkpoint', async () => {
  const f = make(), marker = `dsh-cf-${f.store.state.instanceId}`;
  f.store.state.setup = SETUP;
  f.store.state.pending = { kind: 'access', marker, at: '2026-10-18T00:00:00Z', path: '/untrusted/path' };
  f.data.apps.push({ id: 'owned-app', name: marker, domain: SETUP.hostname, secret: 'DO-NOT-EXPOSE' }, { id: 'unrelated', name: 'similar-name', domain: SETUP.hostname });
  const before = JSON.stringify(f.store.state);
  const result = await inspectPending(f.cf, f.store);
  assert.equal(result.status, 'found'); assert.deepEqual(result.matches, [{ id: 'owned-app', recorded: false }]);
  assert.equal(JSON.stringify(f.store.state), before); assert.equal(f.data.writes.length, 0);
  assert(!JSON.stringify(result).includes('DO-NOT-EXPOSE'));
  f.store.state.owned.appId = 'another-id';
  assert.equal((await inspectPending(f.cf, f.store)).status, 'ambiguous');
  f.data.apps = [];
  assert.equal((await inspectPending(f.cf, f.store)).status, 'not-found');
  f.store.state.pending.marker = 'another-instance';
  await assert.rejects(inspectPending(f.cf, f.store), { code: 'WRITE_UNKNOWN' });
});
for (const kind of ['tunnel', 'dns', 'authentication', 'session']) test(`read-only ${kind} inspection keeps resource IDs and the checkpoint unchanged`, async () => {
  const f = make(); await provision(f.cf, f.store, await f.cf.validateSetup(SETUP), 4000);
  const marker = `dsh-cf-${f.store.state.instanceId}`, writes = f.data.writes.length;
  f.store.state.pending = { kind, marker, at: '2026-10-18T00:00:00Z' };
  const before = JSON.stringify(f.store.state);
  const result = await inspectPending(f.cf, f.store);
  assert.equal(result.status, 'found'); assert.equal(result.matches[0].recorded, true);
  assert.equal(JSON.stringify(f.store.state), before); assert.equal(f.data.writes.length, writes);
});
test('cancelled pending inspection cannot publish a stale result', async () => {
  const f = make(), abort = new AbortController();
  f.store.state.setup = SETUP;
  f.store.state.pending = { kind: 'access', marker: `dsh-cf-${f.store.state.instanceId}` };
  f.cf.list = async () => { abort.abort(); return []; };
  await assert.rejects(inspectPending(f.cf, f.store, abort.signal), { name: 'AbortError' });
  assert(f.store.state.pending); assert.equal(f.data.writes.length, 0);
});
test('provision builds an owner/WebAuthn app before tunnel and DNS; retry does not duplicate writes', async () => {
  const f = make(); const setup = await f.cf.validateSetup(SETUP);
  await provision(f.cf, f.store, setup, 4000);
  assert.equal(f.store.state.owned.audience, AUD); assert.equal(f.store.state.pending, null);
  assert.equal(f.data.writes[0].p.split('/').at(-1), 'apps'); assert.equal(f.data.writes.at(-1).p.split('/').at(-1), 'dns_records');
  assert.deepEqual(f.data.apps[0].policies[0].include, [{ email: { email: SETUP.ownerEmail } }]);
  assert.equal(f.data.apps[0].mfa_config.mfa_disabled, false);
  assert.equal(f.store.token, connectorToken());
  assert.equal(f.data.configs.get(TUNNEL).config.ingress[0].originRequest.access.required, true);
  const count = f.data.writes.length; await provision(f.cf, f.store, setup, 4000); assert.equal(f.data.writes.length, count);
  assert(!JSON.stringify(f.store.saves).includes('test-management-token'));
});
for (const resource of ['dns', 'access']) test(`existing unrelated ${resource} is never overwritten`, async () => {
  const f = make();
  if (resource === 'dns') f.data.records.push({ id: 'other', name: SETUP.hostname, type: 'CNAME', content: 'keep.example.org' });
  else f.data.apps.push({ id: 'other', name: 'KEEP', domain: '*.example.com' });
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: resource === 'dns' ? 'DNS_CONFLICT' : 'ACCESS_CONFLICT' });
  assert.equal(f.data.writes.length, 0);
});
test('empty owner fails before any Cloudflare request', async () => {
  const f = make(); await assert.rejects(f.cf.validateSetup({ ...SETUP, ownerEmail: '' }), { code: 'OWNER' }); assert.equal(f.data.writes.length, 0);
});
test('lost POST result blocks duplicate creation and preserves a recovery checkpoint', async () => {
  const f = make(); f.data.fail = ({ method }) => { if (method === 'POST') throw new Error('Connection lost'); };
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'CF_NETWORK' }); assert.equal(f.store.state.pending.kind, 'access');
  f.data.fail = null; await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'WRITE_UNKNOWN' }); assert.equal(f.data.writes.length, 1);
});
test('definitive 403 clears only pending-write uncertainty, not other state', async () => {
  const f = make(); f.data.fail = ({ method }) => method === 'POST' ? Response.json({ success: false }, { status: 403 }) : null;
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'CF_403' }); assert.equal(f.store.state.pending, null); assert.deepEqual(f.store.state.setup, SETUP);
});
test('MFA shared change requires fresh revision and preserves existing organization settings', async () => {
  const f = make(); f.data.organization.mfa_config.allowed_authenticators = ['totp'];
  const before = await f.cf.account(ACCOUNT);
  await assert.rejects(f.cf.enableMfa(ACCOUNT, 'stale'), { code: 'ORG_CHANGED' }); assert.equal(f.data.writes.length, 0);
  await f.cf.enableMfa(ACCOUNT, before.organizationRevision);
  assert.deepEqual(f.data.organization.mfa_config.allowed_authenticators, ['totp', 'biometrics', 'security_key']);
  assert.equal(f.data.organization.mfa_required_for_all_apps, false); assert.equal(f.data.organization.name, 'Existing organization');
});
test('an already cancelled Cloudflare call never reaches a fetch implementation that ignores signals', async () => {
  let calls = 0;
  const cf = new Cloudflare('test-management-token-123456789', async () => { calls++; return Response.json({ success: true, result: {} }); });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(cf.call('PUT', `/accounts/${ACCOUNT}/access/organizations`, {}, abort.signal), { name: 'AbortError' });
  assert.equal(calls, 0);
});
test('cancelled MFA read cannot issue a later PUT when the fetch implementation ignores signals', async () => {
  const f = make(); const account = await f.cf.account(ACCOUNT);
  const reading = Promise.withResolvers(), response = Promise.withResolvers();
  f.data.fail = async ({ p, method }) => {
    if (method === 'GET' && p.endsWith('/access/organizations')) { reading.resolve(); await response.promise; }
  };
  const abort = new AbortController();
  const enabling = f.cf.enableMfa(ACCOUNT, account.organizationRevision, abort.signal);
  const rejected = assert.rejects(enabling, { name: 'AbortError' });
  await reading.promise; abort.abort(); response.resolve(); await rejected;
  assert.equal(f.data.writes.length, 0);
});
test('additional allow or bypass policy fails closed', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  f.data.policies.get('app-1').push({ decision: 'bypass', include: [{ everyone: {} }] });
  await assert.rejects(validateAccess(f.cf, SETUP, f.store.state.owned, f.store.state.instanceId), { code: 'POLICY_CHANGED' });
});
test('weaker per-policy MFA override is not accepted', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  f.data.policies.get('app-1')[0].mfa_config = { mfa_disabled: false, allowed_authenticators: ['totp'] };
  await assert.rejects(validateAccess(f.cf, SETUP, f.store.state.owned, f.store.state.instanceId), { code: 'MFA_CHANGED' });
});
test('changed ingress is refused rather than silently repaired', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  f.data.configs.get(TUNNEL).config.ingress[0].service = 'http://other.internal:80';
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'TUNNEL_CHANGED' });
});
test('changed Tunnel Access team is rejected without overwriting the existing ingress', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  f.data.configs.get(TUNNEL).config.ingress[0].originRequest.access.teamName = 'another-team';
  const writes = f.data.writes.length;
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'TUNNEL_CHANGED' });
  assert.equal(f.data.writes.length, writes);
  assert.equal(f.data.configs.get(TUNNEL).config.ingress[0].originRequest.access.teamName, 'another-team');
});
test('initial ingress write must read back the requested routing before DNS is created', async () => {
  const f = make();
  f.data.fail = ({ p, method, body }) => {
    if (method === 'PUT' && p.endsWith('/configurations')) body.config.ingress = [];
  };
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'TUNNEL_CHANGED' });
  assert.equal(f.data.records.length, 0);
  assert.equal(f.store.saves.at(-1).owned.tunnelId, TUNNEL);
  assert.equal(f.store.saves.at(-1).pending, null);
  f.data.fail = null; await removeOwned(f.cf, f.store);
  assert.deepEqual(f.store.state.owned, {});
});
test('an unavailable ingress read retains owned IDs and retry does not duplicate resources', async () => {
  const f = make();
  f.data.fail = ({ p, method }) => { if (method === 'GET' && p.endsWith('/configurations')) throw new Error('readback unavailable'); };
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'CF_NETWORK' });
  assert.equal(f.store.saves.at(-1).owned.tunnelId, TUNNEL);
  assert.equal(f.store.state.pending, null);
  f.data.fail = null; await provision(f.cf, f.store, SETUP, 4000);
  assert.equal(f.data.writes.filter(w => w.method === 'POST').length, 3);
  assert.equal(f.data.writes.filter(w => w.method === 'PUT' && w.p.endsWith('/configurations')).length, 1);
});
test('initial DNS readback rejects an unproxied record while retaining its ID for cleanup', async () => {
  const f = make();
  f.data.fail = ({ p, method, body }) => { if (method === 'POST' && p.endsWith('/dns_records')) body.proxied = false; };
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'DNS_CHANGED' });
  assert.equal(f.store.saves.at(-1).owned.dnsId, 'dns-1');
  assert.equal(f.store.saves.at(-1).pending, null);
  const writes = f.data.writes.length;
  f.data.fail = null;
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'DNS_CHANGED' });
  assert.equal(f.data.writes.length, writes);
  await removeOwned(f.cf, f.store);
  assert.deepEqual(f.store.state.owned, {}); assert.equal(f.data.records.length, 0);
});
test('an unavailable initial DNS readback preserves the known result and retry does not repeat POST', async () => {
  const f = make();
  f.data.fail = ({ p, method }) => { if (method === 'GET' && p.endsWith('/dns_records/dns-1')) throw new Error('readback unavailable'); };
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'CF_NETWORK' });
  assert.equal(f.store.saves.at(-1).owned.dnsId, 'dns-1');
  assert.equal(f.store.saves.at(-1).pending, null);
  const writes = f.data.writes.length;
  f.data.fail = null; await provision(f.cf, f.store, SETUP, 4000);
  assert.equal(f.data.writes.length, writes);
});
test('remove verifies owned IDs, deletes DNS first, and leaves shared MFA untouched', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000); const org = JSON.stringify(f.data.organization); const from = f.data.writes.length;
  await removeOwned(f.cf, f.store);
  assert.match(f.data.writes[from].p, /dns_records/); assert.equal(f.data.writes[from].method, 'DELETE');
  assert.deepEqual(f.store.state.owned, {}); assert.equal(f.store.token, null); assert.equal(JSON.stringify(f.data.organization), org);
});
test('owned Tunnel connections are cleaned up before the Tunnel is deleted', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000); const from = f.data.writes.length;
  await removeOwned(f.cf, f.store);
  const deletes = f.data.writes.slice(from).filter(w => w.method === 'DELETE').map(w => w.p.replace(/^\/accounts\/[a-f0-9]+/, '').replace(/^\/zones\/[a-f0-9]+/, ''));
  assert.deepEqual(deletes, ['/dns_records/dns-1', `/cfd_tunnel/${TUNNEL}/connections`, `/cfd_tunnel/${TUNNEL}`, '/access/apps/app-1']);
  assert.equal(f.data.tunnels.length, 0);
});
test('lists use the documented 50-item page size and follow total_pages', async () => {
  const seen = []; const accounts = Array.from({ length: 73 }, (_, i) => ({ id: i.toString(16).padStart(32, '0'), name: `Account ${i}` }));
  const fetchImpl = async url => {
    const u = new URL(url); seen.push(u.search); const page = Number(u.searchParams.get('page')), size = Number(u.searchParams.get('per_page'));
    if (size > 50) return Response.json({ success: false, errors: [{ code: 1001 }] }, { status: 400 });
    return Response.json({ success: true, result: accounts.slice((page - 1) * size, page * size), result_info: { page, per_page: size, total_pages: Math.ceil(accounts.length / size) } });
  };
  const list = await new Cloudflare('test-management-token-123456789', fetchImpl).accounts();
  assert.equal(list.length, 73); assert.deepEqual(seen, ['?per_page=50&page=1', '?per_page=50&page=2']);
});
test('lists without total_pages stop on a short page', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; return Response.json({ success: true, result: Array.from({ length: calls === 1 ? 50 : 3 }, (_, i) => ({ id: `${calls}-${i}` })) }); };
  assert.equal((await new Cloudflare('test-management-token-123456789', fetchImpl).list('/accounts/x/access/apps')).length, 53); assert.equal(calls, 2);
});
test('a read that cannot reach Cloudflare is not reported as an uncertain write', async () => {
  const cf = new Cloudflare('test-management-token-123456789', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(cf.accounts(), e => e.code === 'CF_NETWORK' && !/write/.test(e.message));
  await assert.rejects(cf.call('POST', '/accounts/x/cfd_tunnel', {}), e => e.code === 'CF_NETWORK' && /recorded write/.test(e.message));
  await assert.rejects(cf.call('DELETE', '/accounts/x/cfd_tunnel/y/connections'), e => e.code === 'CF_NETWORK' && !/recorded write/.test(e.message) && /retry/.test(e.message));
});
test('changed DNS ownership stops deletion', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000); f.data.records[0].content = 'unrelated.example.com';
  await assert.rejects(removeOwned(f.cf, f.store), { code: 'DNS_CHANGED' }); assert.equal(f.data.tunnels.length, 1);
});
test('raw errors and remote response bodies are not exposed in diagnostics', () => {
  assert(!JSON.stringify(safeError(new Error('Bearer SECRET'))).includes('SECRET'));
  assert.equal(safeError(new CfError('LOCAL', 'Safe failure')).code, 'LOCAL');
});
test('optional organization AMR fields follow the API contract while malformed and enabled values block publication', async () => {
  const { mfaAssurance } = await import('../src/cloudflare.js');
  const base = { allowed_authenticators: ['biometrics', 'security_key'], session_duration: '8h' };
  assert.equal(mfaAssurance({ mfa_config: { ...base } }).state, 'independent');
  assert.equal(mfaAssurance({ mfa_config: { ...base, amr_matching_session_duration: null } }).state, 'independent');
  assert.equal(mfaAssurance({ mfa_config: {} }).state, 'unknown');
  assert.equal(mfaAssurance({ mfa_config: { ...base, session_duration: 'invalid' } }).state, 'unknown');
  assert.equal(mfaAssurance({ mfa_config: { ...base, allowed_authenticators: null } }).state, 'unknown');
  assert.equal(mfaAssurance({ mfa_config: { ...base, amr_matching_enabled: false } }).state, 'independent');
  assert.equal(mfaAssurance({ mfa_config: { ...base, amr_matching_enabled: true } }).state, 'substitute');
  assert.equal(mfaAssurance({ mfa_config: { ...base, amr_matching_session_duration: '30m' } }).state, 'substitute');
  assert.equal(mfaAssurance({ mfa_config: { ...base, amr_session_duration: '0m' } }).state, 'substitute');
  assert.equal(mfaAssurance({ mfa_config: { ...base, amr_matching_enabled: 'yes' } }).state, 'unknown');
  assert.equal(mfaAssurance({ mfa_config: { ...base, amr_matching_session_duration: 'forever' } }).state, 'unknown');
  assert.equal(mfaAssurance({ mfa_config: { ...base, amr_matching_enabled: true, amr_matching_session_duration: 5 } }).state, 'unknown');
  assert.equal(mfaAssurance({}).state, 'unknown');
  const f = make();
  delete f.data.organization.mfa_config.amr_matching_enabled;
  assert.deepEqual(await f.cf.validateSetup(SETUP), SETUP);
  assert.equal(f.data.writes.length, 0);
  f.data.organization.mfa_config.amr_matching_enabled = false;
  f.data.organization.mfa_config.amr_matching_session_duration = '30m';
  await assert.rejects(f.cf.validateSetup(SETUP), { code: 'MFA_IDP_SUBSTITUTE' });
  assert.equal(f.data.writes.length, 0);
  f.data.organization.mfa_config.amr_matching_session_duration = 'nope';
  await assert.rejects(f.cf.validateSetup(SETUP), { code: 'MFA_UNKNOWN' });
  assert.equal(f.data.writes.length, 0);
});
test('enabling authenticators keeps an existing IdP MFA shortcut unchanged', async () => {
  const f = make();
  f.data.organization.mfa_config.allowed_authenticators = ['totp'];
  f.data.organization.mfa_config.amr_matching_session_duration = '30m';
  f.data.organization.mfa_config.amr_matching_enabled = true;
  const account = await f.cf.account(ACCOUNT);
  await f.cf.enableMfa(ACCOUNT, account.organizationRevision);
  assert.equal(f.data.organization.mfa_config.amr_matching_session_duration, '30m');
  assert.equal(f.data.organization.mfa_config.amr_matching_enabled, true);
  assert.equal(f.data.writes.at(-1).body.mfa_config.amr_matching_enabled, true);
  assert.equal(f.data.organization.name, 'Existing organization');
});
test('Access validation rejects IdP MFA substitution without another write', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  f.data.organization.mfa_config.amr_matching_enabled = true;
  const writes = f.data.writes.length;
  await assert.rejects(validateAccess(f.cf, SETUP, f.store.state.owned, f.store.state.instanceId), { code: 'MFA_IDP_SUBSTITUTE' });
  assert.equal(f.data.writes.length, writes);
});
test('a tunnel create stores its token only when the account and tunnel ids match', async () => {
  const mismatched = connectorToken({ accountId: 'b'.repeat(32), secret: tokenSecret('mismatched-create') });
  const short = connectorToken({ secret: Buffer.alloc(31, 7) });
  for (const bad of [mismatched, short]) {
    const f = make();
    f.data.fail = ({ p, method, body }) => {
      if (method === 'POST' && p.endsWith('/cfd_tunnel')) return reply({ ...body, id: TUNNEL, token: bad });
      return null;
    };
    await assert.rejects(provision(f.cf, f.store, SETUP, 4000), error => error.code === 'TOKEN' && !error.message.includes(bad) && !error.message.includes('mismatched'));
    assert.equal(f.store.token, null);
  }
});
test('a tunnel token is replaced only after a valid read of the owned tunnel', async t => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Store } = await import('../src/store.js');
  const { refreshTunnelToken } = await import('../src/cloudflare.js');
  const { reply } = await import('./helpers.js');
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cf-token-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new Store(dir).open();
  t.after(() => store.close());
  const f = make();
  f.data.tunnels.push({ id: TUNNEL, name: `dsh-cf-${store.state.instanceId}` });
  store.state.setup = { ...SETUP };
  store.state.owned = { tunnelId: TUNNEL };
  assert.equal(parseConnectorToken(connectorToken({ secret: Buffer.alloc(31, 9) })), null);
  assert.equal(parseConnectorToken(connectorToken({ secret: Buffer.alloc(32, 9) }))?.tunnelId, TUNNEL);
  const original = connectorToken({ secret: tokenSecret('original-connector-secret') });
  await store.writeToken(original);
  const standard = connectorToken({ secret: Buffer.alloc(32, 0xfb) });
  const next = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.notEqual(next, standard);
  f.data.fail = ({ p, method }) => method === 'GET' && p.endsWith('/token') ? reply({ token: next }) : null;
  await refreshTunnelToken(f.cf, store);
  assert.equal(await readFile(join(dir, 'tunnel.token'), 'utf8'), next);
  assert.equal(store.state.owned.tunnelId, TUNNEL);
  assert.equal(f.data.writes.length, 0);
  const rejected = ['short', 'x'.repeat(40), connectorToken({ accountId: 'b'.repeat(32) }), connectorToken({ tunnelId: '22222222-2222-4222-8222-222222222222' })];
  for (const bad of rejected) {
    f.data.fail = ({ p, method }) => method === 'GET' && p.endsWith('/token') ? reply(bad) : null;
    await assert.rejects(refreshTunnelToken(f.cf, store), error => error.code === 'TOKEN' && !error.message.includes(bad) && !error.message.includes(next) && !error.message.includes('short'));
    assert.equal(await readFile(join(dir, 'tunnel.token'), 'utf8'), next);
  }
  const signal = AbortSignal.abort();
  f.data.fail = ({ p, method }) => method === 'GET' && p.endsWith('/token') ? reply(connectorToken({ secret: tokenSecret('cancelled-refresh') })) : null;
  await assert.rejects(refreshTunnelToken(f.cf, store, signal));
  assert.equal(await readFile(join(dir, 'tunnel.token'), 'utf8'), next);
  f.data.fail = ({ p, method }) => method === 'GET' && p.endsWith('/token') ? Response.json({ success: false }, { status: 500 }) : null;
  await assert.rejects(refreshTunnelToken(f.cf, store), { code: 'CF_500' });
  assert.equal(await readFile(join(dir, 'tunnel.token'), 'utf8'), next);
  f.data.tunnels[0].name = 'other-tunnel';
  f.data.fail = null;
  await assert.rejects(refreshTunnelToken(f.cf, store), { code: 'TUNNEL_CHANGED' });
  assert.equal(await readFile(join(dir, 'tunnel.token'), 'utf8'), next);
  assert.equal(store.state.owned.tunnelId, TUNNEL);
});

test('Access-only sign-in requires explicit false, validates input and does not require organization WebAuthn', async () => {
  const f = make(); delete f.data.organization.mfa_config;
  await assert.rejects(f.cf.validateSetup(SETUP), { code: 'MFA_UNKNOWN' });
  for (const requireWebAuthn of ['false', 0, null]) {
    await assert.rejects(f.cf.validateSetup({ ...SETUP, requireWebAuthn }), { code: 'MFA_MODE' });
  }
  const setup = await f.cf.validateSetup({ ...SETUP, requireWebAuthn: false });
  await provision(f.cf, f.store, setup, 4000);
  assert.equal('mfa_config' in f.data.apps[0], false, 'Access-only apps are created without mfa_config');
  assert.deepEqual(f.data.policies.get('app-1')[0].include, [{ email: { email: SETUP.ownerEmail } }]);
  assert.equal(f.data.apps[0].session_duration, '168h');
  assert(f.store.state.owned.audience);
  assert.equal(f.data.writes.some(w => w.p.endsWith('/access/organizations')), false);
  assert.equal(f.store.state.setup.requireWebAuthn, false);
  await validateAccess(f.cf, setup, f.store.state.owned, f.store.state.instanceId);
  f.data.apps[0].allowed_idps = ['other-provider'];
  await assert.rejects(validateAccess(f.cf, setup, f.store.state.owned, f.store.state.instanceId), { code: 'IDP_CHANGED' });
});

test('Access-only mode still rejects bypass policies, another owner and mismatched MFA settings', async () => {
  for (const change of ['bypass', 'owner', 'mfa', 'policyMfa']) {
    const f = make(), setup = { ...SETUP, requireWebAuthn: false };
    await provision(f.cf, f.store, setup, 4000);
    const policy = f.data.policies.get('app-1')[0];
    if (change === 'bypass') policy.decision = 'bypass';
    if (change === 'owner') policy.include[0].email.email = 'other@example.com';
    if (change === 'mfa') f.data.apps[0].mfa_config = { mfa_disabled: false };
    if (change === 'policyMfa') policy.mfa_config = { mfa_disabled: false, allowed_authenticators: ['totp'] };
    await assert.rejects(validateAccess(f.cf, setup, f.store.state.owned, f.store.state.instanceId));
  }
});

test('an explicit mode change reuses only the owned app, Tunnel and DNS and clears earlier verification', async () => {
  const f = make();
  await provision(f.cf, f.store, SETUP, 4000);
  const ids = { ...f.store.state.owned }, organization = structuredClone(f.data.organization);
  f.store.state.proven = true; f.store.state.autoConnect = true; f.store.state.lastVerifiedAt = 'old';
  const setup = await f.cf.validateSetup({ ...SETUP, requireWebAuthn: false });
  const before = f.data.writes.length;
  await provision(f.cf, f.store, setup, 4000);
  const writes = f.data.writes.slice(before);
  assert.equal(writes.length, 1); assert.equal(writes[0].method, 'PUT'); assert(writes[0].p.endsWith('/access/apps/app-1'));
  assert.deepEqual(f.store.state.owned, ids); assert.deepEqual(f.data.organization, organization);
  assert.equal(f.store.state.setup.requireWebAuthn, false); assert.equal(f.store.state.pending, null);
  assert.equal(f.store.state.proven, false); assert.equal(f.store.state.autoConnect, false); assert.equal(f.store.state.lastVerifiedAt, null);
  await provision(f.cf, f.store, { ...SETUP, requireWebAuthn: true }, 4000);
  assert.equal(f.data.apps[0].mfa_config.mfa_disabled, false);
  assert.equal(f.store.state.setup.requireWebAuthn, true);
});

test('unrelated setup changes and pre-existing policy overrides cannot be changed with the mode', async () => {
  for (const other of ['owner', 'override']) {
    const f = make(); await provision(f.cf, f.store, SETUP, 4000);
    const setup = { ...SETUP, requireWebAuthn: false };
    if (other === 'owner') setup.ownerEmail = 'other@example.com';
    else f.data.policies.get('app-1')[0].mfa_config = { mfa_disabled: false, allowed_authenticators: ['biometrics', 'security_key'] };
    const before = f.data.writes.length;
    await assert.rejects(provision(f.cf, f.store, setup, 4000));
    assert.equal(f.data.writes.length, before); assert.deepEqual(f.store.state.setup, SETUP);
  }
});

test('a lost mode-change response is settled by reading the application back: nothing is recorded as pending', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  const setup = { ...SETUP, requireWebAuthn: false };
  f.data.fail = ({ method, p }) => { if (method === 'PUT' && p.endsWith('/access/apps/app-1')) throw new Error('connection lost'); };
  await assert.rejects(provision(f.cf, f.store, setup, 4000), { code: 'CF_NETWORK' });
  assert.equal(f.store.state.pending, null); assert.deepEqual(f.store.state.setup, SETUP, 'the old mode is still recorded: the app was not changed');
  f.data.fail = null;
  await provision(f.cf, f.store, setup, 4000);
  assert.equal(f.store.state.setup.requireWebAuthn, false); assert.equal(f.store.state.pending, null);
});

test('a mode change that landed although its response was lost is recognized as applied', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  const setup = { ...SETUP, requireWebAuthn: false };
  f.data.fail = ({ method, p, body }) => { if (method === 'PUT' && p.endsWith('/access/apps/app-1')) { Object.assign(f.data.apps[0], body); throw new Error('connection lost after commit'); } };
  await provision(f.cf, f.store, setup, 4000);
  assert.equal(f.store.state.setup.requireWebAuthn, false); assert.equal(f.store.state.pending, null);
  assert.equal(f.store.state.proven, false);
});

test('an application changed by somebody else during a lost update is reported, not guessed at', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  f.data.fail = ({ method, p }) => { if (method === 'PUT' && p.endsWith('/access/apps/app-1')) { f.data.apps[0].session_duration = '30m'; throw new Error('lost'); } };
  f.data.apps[0].session_duration = '1h';
  await assert.rejects(provision(f.cf, f.store, { ...SETUP }, 4000), { code: 'ACCESS_CHANGED' });
  assert.equal(f.store.state.pending, null);
});

test('mode-change readback failures are ordinary errors: the write is known, so no checkpoint is kept', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  let updated = false;
  f.data.fail = ({ method, p }) => {
    if (method === 'PUT' && p.endsWith('/access/apps/app-1')) updated = true;
    if (updated && method === 'GET' && p.endsWith('/access/apps/app-1')) return Response.json({ success: false }, { status: 403 });
  };
  await assert.rejects(provision(f.cf, f.store, { ...SETUP, requireWebAuthn: false }, 4000), { code: 'CF_403' });
  assert.equal(f.store.state.pending, null); assert.deepEqual(f.store.state.setup, SETUP);
  f.data.fail = null;
  const writes = f.data.writes.length;
  await provision(f.cf, f.store, { ...SETUP, requireWebAuthn: false }, 4000);
  assert.equal(f.store.state.setup.requireWebAuthn, false);
  assert.equal(f.data.writes.length, writes, 'retry reads the applied mode without replaying the PUT');
});

test('mode-change rejected writes preserve the previous setup and clear only the pending write', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  f.data.fail = ({ method, p }) => method === 'PUT' && p.endsWith('/access/apps/app-1') ? Response.json({ success: false }, { status: 403 }) : null;
  await assert.rejects(provision(f.cf, f.store, { ...SETUP, requireWebAuthn: false }, 4000), { code: 'CF_403' });
  assert.equal(f.store.state.pending, null); assert.deepEqual(f.store.state.setup, SETUP);
  assert.equal(f.data.apps[0].mfa_config.mfa_disabled, false);
});

test('saving an existing one-hour app updates only its session to one week and is idempotent', async () => {
  const f = make(), setup = { ...SETUP, requireWebAuthn: false };
  await provision(f.cf, f.store, setup, 4000);
  f.data.apps[0].session_duration = '1h';
  const before = f.data.writes.length, ids = { ...f.store.state.owned }, mfa = structuredClone(f.data.apps[0].mfa_config);
  await provision(f.cf, f.store, setup, 4000);
  const writes = f.data.writes.slice(before);
  assert.equal(writes.length, 1); assert.equal(writes[0].method, 'PUT'); assert(writes[0].p.endsWith('/access/apps/app-1'));
  assert.equal(f.data.apps[0].session_duration, '168h'); assert.deepEqual(f.data.apps[0].mfa_config, mfa);
  assert.deepEqual(f.store.state.owned, ids); assert.equal(f.store.state.pending, null);
  await provision(f.cf, f.store, setup, 4000);
  assert.equal(f.data.writes.length, before + 1);
});

test('a policy session override is not silently extended or reported as a week', async () => {
  const f = make(), setup = { ...SETUP, requireWebAuthn: false };
  await provision(f.cf, f.store, setup, 4000);
  f.data.policies.get('app-1')[0].session_duration = '30m';
  for (const duration of ['1h', '168h']) {
    f.data.apps[0].session_duration = duration;
    const before = f.data.writes.length;
    await assert.rejects(provision(f.cf, f.store, setup, 4000), { code: 'SESSION_CHANGED' });
    assert.equal(f.data.writes.length, before);
    assert.equal(f.data.policies.get('app-1')[0].session_duration, '30m');
  }
});

test('a session update with a lost response is not recorded as pending and may be repeated', async () => {
  const f = make(), setup = { ...SETUP, requireWebAuthn: false };
  await provision(f.cf, f.store, setup, 4000); f.data.apps[0].session_duration = '1h';
  f.data.fail = ({ method, p }) => { if (method === 'PUT' && p.endsWith('/access/apps/app-1')) throw new Error('lost'); };
  await assert.rejects(provision(f.cf, f.store, setup, 4000), { code: 'CF_NETWORK' });
  assert.equal(f.store.state.pending, null);
  f.data.fail = null;
  await provision(f.cf, f.store, setup, 4000);
  assert.equal(f.data.apps[0].session_duration, '168h');
});

test('a session update that landed although its response was lost counts as done', async () => {
  const f = make(), setup = { ...SETUP, requireWebAuthn: false };
  await provision(f.cf, f.store, setup, 4000); f.data.apps[0].session_duration = '1h';
  f.data.fail = ({ method, p, body }) => { if (method === 'PUT' && p.endsWith('/access/apps/app-1')) { Object.assign(f.data.apps[0], body); throw new Error('lost after commit'); } };
  await provision(f.cf, f.store, setup, 4000);
  assert.equal(f.store.state.pending, null); assert.equal(f.data.apps[0].session_duration, '168h');
});

test('a session update must read back the requested one-week duration, and a mismatch is an ordinary error', async () => {
  const f = make(), setup = { ...SETUP, requireWebAuthn: false };
  await provision(f.cf, f.store, setup, 4000); f.data.apps[0].session_duration = '1h';
  f.data.fail = ({ method, p, body }) => { if (method === 'PUT' && p.endsWith('/access/apps/app-1')) body.session_duration = '1h'; };
  await assert.rejects(provision(f.cf, f.store, setup, 4000), { code: 'SESSION_CHANGED' });
  assert.equal(f.store.state.pending, null);
});

test('a read-back mismatch after a successful PUT is an ordinary error and keeps no checkpoint', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  f.data.apps[0].session_duration = '24h';
  f.data.fail = ({ method, p }) => { if (method === 'PUT' && /access\/apps\//.test(p)) { f.data.apps[0].session_duration = '168h'; f.data.apps[0].allowed_idps = ['other']; return reply(f.data.apps[0]); } };
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'IDP_CHANGED' });
  assert.equal(f.store.state.pending, null);
});

test('a session-only update keeps verification and auto-connect; only an authentication mode change clears them', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  Object.assign(f.store.state, { proven: true, autoConnect: true, lastVerifiedAt: 'verified' });
  f.data.apps[0].session_duration = '1h';
  await provision(f.cf, f.store, SETUP, 4000);
  assert.equal(f.data.apps[0].session_duration, '168h');
  assert.equal(f.store.state.proven, true); assert.equal(f.store.state.autoConnect, true); assert.equal(f.store.state.lastVerifiedAt, 'verified');
  await provision(f.cf, f.store, { ...SETUP, requireWebAuthn: false }, 4000);
  assert.equal(f.store.state.proven, false); assert.equal(f.store.state.autoConnect, false); assert.equal(f.store.state.lastVerifiedAt, null);
});

test('legacy session and authentication checkpoints are re-validated by the next provisioning and then cleared', async () => {
  for (const kind of ['session', 'authentication']) {
    const f = make(); await provision(f.cf, f.store, SETUP, 4000);
    f.store.state.pending = { kind, path: '/old', marker: `dsh-cf-${f.store.state.instanceId}`, at: '2026-10-01T00:00:00Z' };
    await provision(f.cf, f.store, SETUP, 4000);
    assert.equal(f.store.state.pending, null, kind);
  }
  // An authentication switch that did land before the old checkpoint was left behind.
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  f.data.apps[0].mfa_config = { mfa_disabled: true };
  f.store.state.pending = { kind: 'authentication', marker: `dsh-cf-${f.store.state.instanceId}`, at: 'x' };
  await provision(f.cf, f.store, { ...SETUP, requireWebAuthn: false }, 4000);
  assert.equal(f.store.state.pending, null); assert.equal(f.store.state.setup.requireWebAuthn, false);
  // A different, unexpected state still stops.
  const g = make(); await provision(g.cf, g.store, SETUP, 4000);
  g.data.apps[0].mfa_config = { mfa_disabled: true };
  g.store.state.pending = { kind: 'authentication', marker: 'x', at: 'x' };
  await assert.rejects(provision(g.cf, g.store, SETUP, 4000), { code: 'MFA_CHANGED' });
});

test('Access-only switching sends an explicit disable, and readback accepts absent, null or disabled application MFA', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  await provision(f.cf, f.store, { ...SETUP, requireWebAuthn: false }, 4000);
  assert.deepEqual(f.data.writes.filter(w => w.method === 'PUT' && w.p.endsWith('/access/apps/app-1')).at(-1).body.mfa_config, { mfa_disabled: true });
  const setup = { ...SETUP, requireWebAuthn: false };
  for (const value of [undefined, null, { mfa_disabled: true }]) {
    if (value === undefined) delete f.data.apps[0].mfa_config; else f.data.apps[0].mfa_config = value;
    await validateAccess(f.cf, setup, f.store.state.owned, f.store.state.instanceId);
  }
  for (const value of [{}, { mfa_disabled: false }]) {
    f.data.apps[0].mfa_config = value;
    await assert.rejects(validateAccess(f.cf, setup, f.store.state.owned, f.store.state.instanceId), { code: 'MFA_CHANGED' });
  }
  f.data.apps[0].mfa_config = { mfa_disabled: true };
  await provision(f.cf, f.store, SETUP, 4000);
  assert.deepEqual(f.data.apps[0].mfa_config, { mfa_disabled: false, allowed_authenticators: ['biometrics', 'security_key'], session_duration: '1h' });
});

test('the previous configuration check survives reads that fail and is voided only right before a write or by a mismatch', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  f.store.state.lastConfigurationCheck = '2026-10-01T00:00:00Z';
  f.data.fail = ({ method, p }) => { if (method === 'GET' && p.endsWith('/dns_records')) throw new TypeError('fetch failed'); };
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'CF_NETWORK' });
  assert.equal(f.store.state.lastConfigurationCheck, '2026-10-01T00:00:00Z');
  f.data.fail = null; f.data.apps[0].session_duration = '1h';
  f.data.fail = ({ method, p }) => { if (method === 'PUT' && p.endsWith('/access/apps/app-1')) throw new TypeError('lost'); };
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'CF_NETWORK' });
  assert.equal(f.store.state.lastConfigurationCheck, null, 'a write was attempted');
});

test('a failed first attempt with a definitive 4xx leaves the identity fields editable until a resource exists', async () => {
  const f = make();
  f.data.fail = ({ method, p }) => method === 'POST' && p.endsWith('/access/apps') ? Response.json({ success: false }, { status: 403 }) : null;
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'CF_403' });
  assert.deepEqual(Object.keys(f.store.state.owned), []);
  f.data.fail = null;
  const fixed = { ...SETUP, hostname: 'fixed.example.com' };
  await provision(f.cf, f.store, fixed, 4000);
  assert.equal(f.store.state.setup.hostname, 'fixed.example.com');
  await assert.rejects(provision(f.cf, f.store, { ...SETUP }, 4000), { code: 'SETUP_CHANGED' });
});

test('responses are classified by HTTP status before the body: a non-JSON 4xx is definitive, a non-JSON 5xx is not', async () => {
  const f = make();
  f.data.fail = ({ method, p }) => method === 'POST' && p.endsWith('/access/apps') ? new Response('<html>403 Forbidden</html>', { status: 403 }) : null;
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'CF_403' });
  assert.equal(f.store.state.pending, null);
  f.data.fail = ({ method, p }) => method === 'POST' && p.endsWith('/access/apps') ? new Response('<html>Bad gateway</html>', { status: 502 }) : null;
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'CF_502' });
  assert.equal(f.store.state.pending.kind, 'access');
});

test('the public hostname is exactly one label under the selected zone and deeper names fail before any write', async () => {
  const f = make();
  for (const hostname of ['a.b.example.com', 'deep.sub.dsh.example.com']) {
    await assert.rejects(f.cf.validateSetup({ ...SETUP, hostname }), { code: 'HOSTNAME_DEPTH' });
  }
  await assert.rejects(f.cf.validateSetup({ ...SETUP, hostname: 'example.com' }), { code: 'ZONE' });
  assert.equal((await f.cf.validateSetup({ ...SETUP, hostname: 'dsh.example.com' })).hostname, 'dsh.example.com');
  assert.equal(f.data.writes.length, 0);
});

test('a missing Zero Trust organization and a missing identity provider have their own actionable errors', async () => {
  const f = make();
  f.data.fail = ({ p }) => p.endsWith('/access/organizations') ? Response.json({ success: false }, { status: 404 }) : null;
  await assert.rejects(f.cf.account(ACCOUNT), error => error.code === 'NO_ZERO_TRUST' && /Zero Trust/.test(error.message));
  f.data.fail = ({ p }) => p.endsWith('/access/identity_providers') ? reply([]) : null;
  await assert.rejects(f.cf.account(ACCOUNT), error => error.code === 'NO_IDP' && /Authentication/.test(error.message));
});

test('the tunnel routing is written only when it differs: first time, or the local port moved on an owned tunnel', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  const puts = () => f.data.writes.filter(w => w.method === 'PUT' && w.p.endsWith('/configurations')).length;
  assert.equal(puts(), 1);
  await provision(f.cf, f.store, SETUP, 4000); assert.equal(puts(), 1, 'identical routing is not rewritten');
  await provision(f.cf, f.store, SETUP, 4555); assert.equal(puts(), 2);
  assert.equal(f.data.configs.get(TUNNEL).config.ingress[0].service, 'http://127.0.0.1:4555');
  assert.equal(f.store.state.gatePort, 4555);
  // Anything else in the routing is somebody else's configuration and is never overwritten.
  f.data.configs.get(TUNNEL).config.ingress.unshift({ hostname: 'other.example.com', service: 'http://127.0.0.1:1' });
  await assert.rejects(provision(f.cf, f.store, SETUP, 4555), { code: 'TUNNEL_CHANGED' });
  assert.equal(puts(), 2);
});

test('unknown-write recovery: clear-recorded only when every exact match is the recorded ID', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000);
  const marker = `dsh-cf-${f.store.state.instanceId}`;
  f.store.state.pending = { kind: 'access', marker, at: 'x', path: '/untrusted' };
  const before = f.data.writes.length;
  const result = await resolvePending(f.cf, f.store, 'clear-recorded');
  assert.equal(f.store.state.pending, null); assert.equal(result.inspection.status, 'found'); assert.deepEqual(result.deleted, []);
  assert.equal(f.data.writes.length, before, 'nothing was written to Cloudflare');
  f.store.state.pending = { kind: 'access', marker, at: 'x' };
  f.data.apps.push({ id: 'stray', name: marker, domain: SETUP.hostname });
  await assert.rejects(resolvePending(f.cf, f.store, 'clear-recorded'), { code: 'WRITE_MISMATCH' });
  assert(f.store.state.pending);
  f.store.state.owned.appId = 'someone-elses';
  await assert.rejects(resolvePending(f.cf, f.store, 'clear-recorded'), { code: 'WRITE_MISMATCH' });
  await assert.rejects(resolvePending(f.cf, f.store, 'other'), { code: 'PAYLOAD' });
});

test('unknown-write recovery: delete-unrecorded removes only exact marker matches and never the recorded ID', async () => {
  for (const kind of ['access', 'tunnel', 'dns']) {
    const f = make(); await provision(f.cf, f.store, SETUP, 4000);
    const marker = `dsh-cf-${f.store.state.instanceId}`, owned = { ...f.store.state.owned };
    f.data.fail = null;
    if (kind === 'access') f.data.apps.push({ id: 'stray-app', name: marker, domain: SETUP.hostname }, { id: 'lookalike', name: `${marker}-x`, domain: SETUP.hostname }, { id: 'other-host', name: marker, domain: 'other.example.com' });
    if (kind === 'tunnel') f.data.tunnels.push({ id: 'stray-tunnel', name: marker }, { id: 'lookalike', name: 'dsh-cf-other' }, { id: 'deleted', name: marker, deleted_at: 'x' });
    if (kind === 'dns') f.data.records.push({ id: 'stray-dns', name: SETUP.hostname, type: 'CNAME', comment: marker, content: 'whatever.example.com' }, { id: 'a-record', name: SETUP.hostname, type: 'A', comment: marker }, { id: 'no-comment', name: SETUP.hostname, type: 'CNAME', comment: 'mine' });
    f.store.state.pending = { kind, marker, at: 'x', path: '/untrusted/ignored' };
    const from = f.data.writes.length;
    const result = await resolvePending(f.cf, f.store, 'delete-unrecorded');
    assert.deepEqual(result.deleted.map(x => x.id), [`stray-${kind === 'access' ? 'app' : kind}`], kind);
    const deletes = f.data.writes.slice(from).filter(w => w.method === 'DELETE');
    assert(deletes.every(w => !w.p.includes(owned.appId) && !w.p.includes(owned.tunnelId) && !w.p.endsWith(owned.dnsId)), kind);
    if (kind === 'tunnel') assert.deepEqual(deletes.map(w => w.p.split('/').slice(-2).join('/')), ['stray-tunnel/connections', 'cfd_tunnel/stray-tunnel'], kind);
    assert.equal(f.store.state.pending, null); assert.deepEqual(f.store.state.owned, owned);
    const left = [...f.data.apps, ...f.data.tunnels, ...f.data.records].map(x => x.id);
    for (const keep of ['lookalike', 'other-host', 'deleted', 'a-record', 'no-comment'].filter(id => ({ access: ['lookalike', 'other-host'], tunnel: ['lookalike', 'deleted'], dns: ['a-record', 'no-comment'] })[kind].includes(id))) assert(left.includes(keep), `${kind} kept ${keep}`);
    assert(!left.includes(`stray-${kind === 'access' ? 'app' : kind}`), kind);
  }
  const none = make(); await provision(none.cf, none.store, SETUP, 4000);
  none.store.state.pending = { kind: 'access', marker: `dsh-cf-${none.store.state.instanceId}`, at: 'x' };
  await assert.rejects(resolvePending(none.cf, none.store, 'delete-unrecorded'), { code: 'WRITE_MISMATCH' });
  assert(none.store.state.pending);
});

test('unknown-write recovery: clear-not-found needs an empty inspection and writes nothing', async () => {
  const f = make(); f.store.state.setup = SETUP;
  const marker = `dsh-cf-${f.store.state.instanceId}`;
  f.store.state.pending = { kind: 'access', marker, at: 'x' };
  f.data.apps.push({ id: 'surprise', name: marker, domain: SETUP.hostname });
  await assert.rejects(resolvePending(f.cf, f.store, 'clear-not-found'), { code: 'WRITE_MISMATCH' });
  assert(f.store.state.pending);
  f.data.apps = [];
  const result = await resolvePending(f.cf, f.store, 'clear-not-found');
  assert.equal(f.store.state.pending, null); assert.equal(result.inspection.status, 'not-found'); assert.equal(f.data.writes.length, 0);
  await assert.rejects(resolvePending(f.cf, f.store, 'clear-not-found'), { code: 'WRITE_UNKNOWN' });
});

test('recovery cancelled mid-way deletes and clears nothing further', async () => {
  const f = make(); f.store.state.setup = SETUP;
  const marker = `dsh-cf-${f.store.state.instanceId}`, abort = new AbortController();
  f.store.state.pending = { kind: 'access', marker, at: 'x' };
  f.data.apps.push({ id: 'stray', name: marker, domain: SETUP.hostname });
  f.data.fail = ({ method }) => { if (method === 'GET') abort.abort(); };
  await assert.rejects(resolvePending(f.cf, f.store, 'delete-unrecorded', abort.signal), { name: 'AbortError' });
  assert(f.store.state.pending); assert.equal(f.data.writes.length, 0);
});
