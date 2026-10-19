import test from 'node:test';
import assert from 'node:assert/strict';
import { DshAdapter } from '../src/dsh.js';
import { CfError } from '../src/common.js';
import { dshFixture } from './helpers.js';

const HOST = 'dsh.example.com';
async function adapterOf(t, options) { const upstream = await dshFixture(options); t.after(() => upstream.close()); return { upstream, adapter: new DshAdapter(upstream.ctx) }; }

test('trust records the edit it made, and does nothing when the host is already trusted', async t => {
  const { upstream, adapter } = await adapterOf(t);
  const first = await adapter.trust(HOST);
  assert.deepEqual(first.added, { hostname: HOST, form: 'array', created: false });
  assert.deepEqual(upstream.raw.trustedHosts, ['keep.example.com', HOST]); assert.deepEqual(upstream.raw.recovery, { retries: 3 });
  assert.deepEqual(await adapter.trust(HOST), { added: null });
});

test('untrust removes exactly the host this plugin added from an array and leaves the other entries', async t => {
  const { upstream, adapter } = await adapterOf(t);
  const { added } = await adapter.trust(HOST);
  assert.equal(await adapter.untrust(added), 'reverted');
  assert.deepEqual(upstream.raw.trustedHosts, ['keep.example.com']); assert.deepEqual(upstream.raw.recovery, { retries: 3 });
  assert.equal(await adapter.untrust(added), 'absent', 'a second revert finds nothing of ours');
  assert.deepEqual(upstream.raw.trustedHosts, ['keep.example.com']);
});

test('an array this plugin created is removed again, but an entry somebody else added later is kept', async t => {
  const { upstream, adapter } = await adapterOf(t, { trustedHosts: null });
  const { added } = await adapter.trust(HOST);
  assert.deepEqual(added, { hostname: HOST, form: 'array', created: true });
  assert.equal(await adapter.untrust(added), 'reverted'); assert.equal('trustedHosts' in upstream.raw, false);
  const again = await adapter.trust(HOST); upstream.setRaw({ ...upstream.raw, trustedHosts: [HOST, 'later.example.com'] });
  assert.equal(await adapter.untrust(again.added), 'reverted'); assert.deepEqual(upstream.raw.trustedHosts, ['later.example.com']);
});

test('a trustedHosts expression is wrapped on trust and unwrapped only when it is exactly our wrapper', async t => {
  const { upstream, adapter } = await adapterOf(t, { trustedHosts: { __jsExpr: "['from.expr.example']" } });
  upstream.services.connection.requestRejection = ({ headers }) => headers.host === HOST && upstream.raw.trustedHosts.__jsExpr.includes(HOST) ? 401 : 403;
  const { added } = await adapter.trust(HOST);
  assert.equal(added.form, 'expr'); assert.equal(upstream.raw.trustedHosts.__jsExpr, `[...new Set([...(['from.expr.example']), "${HOST}"])]`);
  assert.equal(await adapter.untrust(added), 'reverted'); assert.deepEqual(upstream.raw.trustedHosts, { __jsExpr: "['from.expr.example']" });
  upstream.setRaw({ ...upstream.raw, trustedHosts: { __jsExpr: `[...new Set([...(['edited']), "${HOST}"])].concat(['more'])` } });
  const before = structuredClone(upstream.raw);
  assert.equal(await adapter.untrust(added), 'left'); assert.deepEqual(upstream.raw, before, 'an edited expression is not touched');
});

test('untrust leaves the entry and says so when DSH refuses the edit or the form changed', async t => {
  const { upstream, adapter } = await adapterOf(t);
  const { added } = await adapter.trust(HOST);
  const edit = upstream.services.configEditor.edit;
  upstream.services.configEditor.edit = async () => { throw new Error('Configuration is overridden by a home patch'); };
  assert.equal(await adapter.untrust(added), 'left'); assert(upstream.raw.trustedHosts.includes(HOST));
  upstream.services.configEditor.edit = edit;
  assert.equal(await adapter.untrust({ ...added, form: 'expr' }), 'left'); assert(upstream.raw.trustedHosts.includes(HOST));
  upstream.services.configEditor = undefined;
  assert.equal(await adapter.untrust(added), 'left');
});

test('an unrecognized trustedHosts form is not overwritten on trust', async t => {
  const { adapter } = await adapterOf(t, { trustedHosts: 'not-an-array' });
  await assert.rejects(adapter.trust(HOST), error => error instanceof CfError && error.code === 'DSH_CONFIG');
});
