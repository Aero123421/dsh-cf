import test from 'node:test';
import assert from 'node:assert/strict';
import { Cloudflare, provision, removeOwned, validateAccess } from '../src/cloudflare.js';
import { ACCOUNT, SETUP, AUD, fakeCloudflare, memoryStore } from './helpers.js';
import { CfError, safeError } from '../src/common.js';
const make = () => { const api = fakeCloudflare(); return { ...api, cf: new Cloudflare('test-management-token-123456789', api.fetchImpl), store: memoryStore() }; };
test('provision builds an owner/WebAuthn app before tunnel and DNS; retry does not duplicate writes', async () => {
  const f = make(); const setup = await f.cf.validateSetup(SETUP);
  await provision(f.cf, f.store, setup, 4000);
  assert.equal(f.store.state.owned.audience, AUD); assert.equal(f.store.state.pending, null);
  assert.equal(f.data.writes[0].p.split('/').at(-1), 'apps'); assert.equal(f.data.writes.at(-1).p.split('/').at(-1), 'dns_records');
  assert.deepEqual(f.data.apps[0].policies[0].include, [{ email: { email: SETUP.ownerEmail } }]);
  assert.equal(f.data.apps[0].mfa_config.mfa_disabled, false);
  assert.equal(f.data.configs.get('tunnel-1').config.ingress[0].originRequest.access.required, true);
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
  f.data.configs.get('tunnel-1').config.ingress[0].service = 'http://other.internal:80';
  await assert.rejects(provision(f.cf, f.store, SETUP, 4000), { code: 'TUNNEL_CHANGED' });
});
test('remove verifies owned IDs, deletes DNS first, and leaves shared MFA untouched', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000); const org = JSON.stringify(f.data.organization); const from = f.data.writes.length;
  await removeOwned(f.cf, f.store);
  assert.match(f.data.writes[from].p, /dns_records/); assert.equal(f.data.writes[from].method, 'DELETE');
  assert.deepEqual(f.store.state.owned, {}); assert.equal(f.store.token, null); assert.equal(JSON.stringify(f.data.organization), org);
});
test('changed DNS ownership stops deletion', async () => {
  const f = make(); await provision(f.cf, f.store, SETUP, 4000); f.data.records[0].content = 'unrelated.example.com';
  await assert.rejects(removeOwned(f.cf, f.store), { code: 'DNS_CHANGED' }); assert.equal(f.data.tunnels.length, 1);
});
test('raw errors and remote response bodies are not exposed in diagnostics', () => {
  assert(!JSON.stringify(safeError(new Error('Bearer SECRET'))).includes('SECRET'));
  assert.equal(safeError(new CfError('LOCAL', 'Safe failure')).code, 'LOCAL');
});
