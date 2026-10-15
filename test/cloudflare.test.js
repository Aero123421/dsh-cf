import test from 'node:test';
import assert from 'node:assert/strict';
import { Cloudflare, provision, removeOwned, validateAccess } from '../src/cloudflare.js';
import { parseConnectorToken } from '../src/store.js';
import { ACCOUNT, SETUP, AUD, TUNNEL, connectorToken, tokenSecret, fakeCloudflare, memoryStore, reply } from './helpers.js';
import { CfError, safeError } from '../src/common.js';
const make = () => { const api = fakeCloudflare(); return { ...api, cf: new Cloudflare('test-management-token-123456789', api.fetchImpl), store: memoryStore() }; };
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
  assert.equal(f.store.state.owned.ingressConfigured, undefined);
  assert.equal(f.data.records.length, 0);
  assert.equal(f.store.saves.at(-1).owned.tunnelId, TUNNEL);
  assert.equal(f.store.saves.at(-1).pending, null);
  f.data.fail = null; await removeOwned(f.cf, f.store);
  assert.deepEqual(f.store.state.owned, {});
});
test('an unavailable initial ingress readback retains owned IDs and retry does not duplicate resources', async () => {
  const f = make();
  f.data.fail = ({ p, method }) => { if (method === 'GET' && p.endsWith('/configurations')) throw new Error('readback unavailable'); };
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'CF_NETWORK' });
  assert.equal(f.store.state.owned.ingressConfigured, undefined);
  assert.equal(f.store.saves.at(-1).owned.tunnelId, TUNNEL);
  assert.equal(f.store.state.pending, null);
  f.data.fail = null; await provision(f.cf, f.store, SETUP, 4000);
  assert.equal(f.store.state.owned.ingressConfigured, true);
  assert.equal(f.data.writes.filter(w => w.method === 'POST').length, 3);
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
test('IdP MFA substitution and an unreadable organization block publication without writes', async () => {
  const { mfaAssurance } = await import('../src/cloudflare.js');
  const base = { allowed_authenticators: ['biometrics', 'security_key'] };
  assert.equal(mfaAssurance({ mfa_config: { ...base } }).state, 'unknown');
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
  await assert.rejects(f.cf.validateSetup(SETUP), { code: 'MFA_UNKNOWN' });
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
