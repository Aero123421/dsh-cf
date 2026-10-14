import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { Updates, compareVersions, checkedCandidate, supportsSource, dshPeerSatisfies, releaseSpecs, VERSION } from '../src/updates.js';
import manifest from '../package.json' with { type: 'json' };
const PROFILE_KEY = 'a'.repeat(64);
const RUNTIME = '0.2.1-alpha.2', REPO = 'Aero123421/dsh-cf';
const NEXT = '0.1.0-alpha.5';
function release(version, id = 1) { return { id, tag_name: 'v'+version, draft: false, prerelease: version.includes('-'), html_url: `https://github.com/${REPO}/releases/tag/v${version}`, body: 'Release notes', assets: [] }; }
const DSH_RANGE = '>=0.2.1-alpha.2 <0.3.0-0';
function pkg(version = NEXT, peer = RUNTIME) {
  return { name: 'dsh-cf', version, dsh: { bundle: { patch: './cordis.patch.yml' } }, exports: { '.': './src/index.js', './client': './src/client.js' }, peerDependencies: peer && typeof peer === 'object' ? peer : { '@deepseek-ai/dsh': peer } };
}
function github(releases = [release(NEXT)], packageValue) {
  return async url => url.includes('/releases?') ? Response.json(releases) : Response.json(packageValue || pkg(url.split('/').at(-2).slice(1)));
}
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cf-updates-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const bundle = { name: 'dsh-cf', installed: true, enabled: false, version: VERSION, source: `github:${REPO}#v${VERSION}`, ...options.bundle };
  const calls = [];
  const manager = { listBundles: async () => [bundle], waitForInstall: async () => null, installBundle: async (spec, config) => { calls.push({ spec, config }); bundle.version = NEXT; return { application: 'restart-required', stage: 'install', bundle: 'dsh-cf', version: NEXT, ...options.result }; }, ...options.manager };
  const updates = new Updates({ manager: () => manager, profileDir: dir, runtime: RUNTIME, fetcher: options.fetcher || github(), busy: options.busy, ...options.core });
  return { updates, manager, bundle, dir, calls };
}
test('SemVer precedence is numeric, handles prereleases/builds and rejects malformed tags', () => {
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1); assert.equal(compareVersions('1.0.0-alpha.10', '1.0.0-alpha.2'), 1);
  assert.equal(compareVersions('1.0.0+one', '1.0.0+two'), 0); assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1);
  for (const value of ['v0.1.0', '00.1.0', '0.1', '0.1.0-alpha.01', 'latest']) assert.throws(() => compareVersions(value, '0.1.0'));
});
test('Source-only releases select exactly the chosen channel without requiring assets', async () => {
  const fetcher = github([release('0.1.0', 1), release('0.2.0-alpha.2', 2), release('0.2.0-alpha.10', 3)]);
  assert.equal((await checkedCandidate('stable', RUNTIME, fetcher)).candidate.version, '0.1.0');
  assert.equal((await checkedCandidate('prerelease', RUNTIME, fetcher)).candidate.version, '0.2.0-alpha.10');
  assert.equal((await checkedCandidate('stable', RUNTIME, github())).status, 'channel-empty');
  assert.equal((await checkedCandidate('prerelease', RUNTIME, github([]))).status, 'no-release');
  assert.equal(supportsSource('file:/custom/plugin'), false); assert.equal(supportsSource(`github:${REPO}#v${VERSION}`), true);
  assert.equal(supportsSource(releaseSpecs(`v${VERSION}`)[1]), true);
});
test('DSH peer range includes alpha.2, alpha.3 and later 0.2 prereleases, and excludes 0.3', () => {
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh'], DSH_RANGE);
  for (const version of ['0.2.1-alpha.2', '0.2.1-alpha.3', '0.2.1-alpha.10', '0.2.1', '0.2.2-alpha.1', '0.2.2', '0.2.9-rc.1', '0.2.1-alpha.2+build.1']) assert.equal(dshPeerSatisfies(version, DSH_RANGE), true, version);
  for (const version of ['0.2.0-rc.2', '0.2.1-alpha.1', '0.3.0-0', '0.3.0-alpha.1', '0.3.0', '1.0.0']) assert.equal(dshPeerSatisfies(version, DSH_RANGE), false, version);
  assert.equal(dshPeerSatisfies('0.3.0-alpha.1', '>=0.2.1-alpha.2 <0.3.0'), true);
  assert.equal(dshPeerSatisfies('0.2.1-alpha.2', '0.2.1-alpha.2'), true);
  assert.equal(dshPeerSatisfies('0.2.1-alpha.3', '0.2.1-alpha.2'), false);
  assert.equal(dshPeerSatisfies('0.2.1-alpha.3', '0.2.1-alpha.2 || >=0.2.1-alpha.3 <0.3.0-0'), true);
  for (const range of ['', ' ', '^0.2.1-alpha.2', '~0.2.1', '*', '0.2.x', '>=0.2.1-alpha.2 || ^0.2.2.0', 'workspace:^']) assert.equal(dshPeerSatisfies('0.2.1-alpha.3', range), false, range);
});
test('Invalid metadata, channel mismatch, package identity, compatibility, redirects and sizes fail closed', async () => {
  for (const item of [{ ...release(NEXT), id: 0 }, { ...release(NEXT), prerelease: false }, { ...release(NEXT), html_url: 'https://evil.example' }, { ...release(NEXT), tag_name: 'v0.1.0-alpha.01' }]) await assert.rejects(checkedCandidate('prerelease', RUNTIME, github([item])));
  await assert.rejects(checkedCandidate('prerelease', RUNTIME, github([release(NEXT), release(NEXT)])));
  await assert.rejects(checkedCandidate('prerelease', RUNTIME, github(undefined, { ...pkg(), name: 'other' })));
  await assert.rejects(checkedCandidate('prerelease', '0.2.2', github()), { code: 'UPDATE_COMPATIBILITY' });
  await assert.rejects(checkedCandidate('prerelease', '0.2.1-alpha.3', github()), { code: 'UPDATE_COMPATIBILITY' });
  const ranged = github(undefined, pkg(NEXT, DSH_RANGE));
  for (const runtime of ['0.2.1-alpha.2', '0.2.1-alpha.3', '0.2.2-alpha.1', '0.2.9-rc.1']) assert.equal((await checkedCandidate('prerelease', runtime, ranged)).candidate.version, NEXT);
  for (const runtime of ['0.2.0-rc.2', '0.2.1-alpha.1', '0.3.0-0', '0.3.0-alpha.1', '0.3.0']) await assert.rejects(checkedCandidate('prerelease', runtime, ranged), { code: 'UPDATE_COMPATIBILITY' });
  await assert.rejects(checkedCandidate('prerelease', '0.2.1-alpha.3', github(undefined, pkg(NEXT, '^0.2.1-alpha.2'))), { code: 'UPDATE_COMPATIBILITY' });
  await assert.rejects(checkedCandidate('prerelease', '0.2.1-alpha.3', github(undefined, pkg(NEXT, { '@deepseek-ai/dsh': DSH_RANGE, '@deepseek-ai/dsh-client': '0.2.1-alpha.2' }))), { code: 'UPDATE_COMPATIBILITY' });
  assert.equal((await checkedCandidate('prerelease', '0.2.1-alpha.2', github(undefined, pkg(NEXT, { '@deepseek-ai/dsh': DSH_RANGE, '@deepseek-ai/dsh-client': '0.2.1-alpha.2' })))).status, 'available');
  assert.equal((await checkedCandidate('prerelease', RUNTIME, github(undefined, pkg(NEXT, { '@deepseek-ai/dsh': DSH_RANGE, '@other/tool': 'broken' })))).status, 'available');
  await assert.rejects(checkedCandidate('prerelease', RUNTIME, async () => new Response('[]', { status: 404 })), { code: 'UPDATE_FETCH' });
  await assert.rejects(checkedCandidate('prerelease', RUNTIME, async () => new Response('x'.repeat(600_000))), { code: 'RESPONSE_SIZE' });
  await assert.rejects(checkedCandidate('prerelease', RUNTIME, async (_url, options) => { assert.equal(options.redirect, 'error'); throw new Error('redirect'); }));
});
test('Disabled bundle, explicit GitHub pin and outcome survive restart without touching cloud configuration', async t => {
  const { updates, calls, manager, dir } = await fixture(t), id = randomUUID();
  const checked = await updates.check('prerelease'); assert.equal(checked.status, 'available');
  assert.equal((await updates.install(checked.candidate.id, id, 'prerelease', updates.profileKey)).status, 'restart-required');
  assert.equal(calls[0].config.enabled, false); assert.equal(calls[0].config.requestId, id); assert.equal(calls[0].spec, `github:${REPO}#v${NEXT}`);
  assert.equal((await updates.install(checked.candidate.id, id, 'prerelease', updates.profileKey)).status, 'restart-required'); assert.equal(calls.length, 1);
  const restarted = new Updates({ manager: () => manager, profileDir: dir, runtime: RUNTIME, version: NEXT });
  assert.equal((await restarted.status(id)).status, 'confirmed');
  const record = await readFile(join(dir, '.dsh-cf-updates', `${id}.json`), 'utf8'); assert(!record.includes('token')); assert(!record.includes('cloudflared'));
});
test('Failed, cancelled, overridden, applied-with-old-runtime and wrong manifest versions stay distinct', async t => {
  for (const application of ['failed', 'cancelled', 'overridden', 'applied']) {
    const { updates } = await fixture(t, { result: { application, ...(application === 'cancelled' ? { packageResult: { exitCode: 130 } } : {}) } }), checked = await updates.check('prerelease');
    assert.equal((await updates.install(checked.candidate.id, randomUUID(), 'prerelease', updates.profileKey)).status, application === 'applied' ? 'restart-required' : application);
  }
  const { updates } = await fixture(t, { result: { application: 'applied', version: '9.0.0' } }), checked = await updates.check('prerelease');
  assert.equal((await updates.install(checked.candidate.id, randomUUID(), 'prerelease', updates.profileKey)).status, 'unknown');
  assert.equal((await updates.check('stable')).status, 'unknown');
});
test('Optional manager/read-only/unsupported source leaves other plugin capabilities independent', async t => {
  const noManager = new Updates({ manager: () => undefined, profileDir: undefined, runtime: RUNTIME });
  assert.equal((await noManager.status()).status, 'unavailable');
  for (const bundle of [{ readOnlyReason: 'management-required' }, { source: 'file:/dev/plugin' }]) {
    const { updates } = await fixture(t, { bundle, fetcher: async () => { throw Error('must not fetch'); } });
    assert.equal((await updates.status()).status, 'unavailable');
  }
});
test('Pending result is protected across Clients and newer candidates; null reconciliation never succeeds', async t => {
  let installs = 0, version = NEXT;
  const fetcher = async url => url.includes('/releases?') ? Response.json([release(version)]) : Response.json(pkg(version));
  const { updates, manager, dir } = await fixture(t, { fetcher, manager: { installBundle: async () => { installs++; throw Error('lost'); } } });
  const checked = await updates.check('prerelease'), id = randomUUID();
  assert.equal((await updates.install(checked.candidate.id, id, 'prerelease', updates.profileKey)).status, 'unknown');
  version = '0.1.0-alpha.6';
  const next = new Updates({ manager: () => manager, profileDir: dir, runtime: RUNTIME, fetcher });
  assert.equal((await next.status(id)).status, 'unknown');
  assert.equal((await next.install(checked.candidate.id, randomUUID(), 'prerelease', next.profileKey)).status, 'unknown');
  assert.equal((await next.check('prerelease', updates.profileKey)).status, 'unknown');
  assert.equal((await next.install(checked.candidate.id, randomUUID(), 'prerelease', next.profileKey)).status, 'unknown'); assert.equal(installs, 1);
});
test('Different pending operation IDs are refused distinctly and no downgrade is offered or installed', async t => {
  let releaseInstall, announce;
  const started = new Promise(resolve => { announce = resolve; });
  const { updates } = await fixture(t, { manager: { installBundle: async () => { announce(); return new Promise(resolve => { releaseInstall = resolve; }); } } });
  const checked = await updates.check('prerelease'), first = updates.install(checked.candidate.id, randomUUID(), 'prerelease', updates.profileKey); await started;
  await assert.rejects(updates.install(checked.candidate.id, randomUUID(), 'prerelease', updates.profileKey), { code: 'UPDATE_BUSY' });
  releaseInstall({ application: 'failed', stage: 'install' }); await first;
  const ahead = await fixture(t, { bundle: { version: '0.1.0-alpha.9' } });
  assert.equal((await ahead.updates.check('prerelease', updates.profileKey)).status, 'restart-required');
  await ahead.updates.install(`${1}:v${NEXT}`, randomUUID(), 'prerelease', ahead.updates.profileKey); assert.equal(ahead.calls.length, 0);
});
test('Failure before manager admission can be checked and retried with a new ID', async t => {
  let busy = false;
  const { updates, calls } = await fixture(t, { busy: () => busy });
  let checked = await updates.check('prerelease'); busy = true;
  assert.equal((await updates.install(checked.candidate.id, randomUUID(), 'prerelease', updates.profileKey)).status, 'failed'); assert.equal(calls.length, 0);
  busy = false; checked = await updates.check('prerelease');
  assert.equal((await updates.install(checked.candidate.id, randomUUID(), 'prerelease', updates.profileKey)).status, 'restart-required'); assert.equal(calls.length, 1);
});
test('Disposal or newly installed version during final await prevents manager invocation', async t => {
  for (const disposed of [true, false]) {
    let count = 0, releaseLookup, announce;
    const final = new Promise(resolve => { announce = resolve; });
    const { updates, calls, bundle } = await fixture(t, { manager: { listBundles: async () => { count++; if (count === 3) { announce(); await new Promise(resolve => { releaseLookup = resolve; }); } return [bundle]; } } });
    const checked = await updates.check('prerelease'), pending = updates.install(checked.candidate.id, randomUUID(), 'prerelease', updates.profileKey); await final;
    if (disposed) updates.dispose(); else bundle.version = '0.1.0-alpha.9';
    releaseLookup(); await pending; assert.equal(calls.length, 0);
  }
});
test('Old Host settlement cannot replace a newer operation pointer', async t => {
  const { updates, dir } = await fixture(t), first = randomUUID(), second = randomUUID();
  updates.operation = { id: first, version: NEXT, channel: 'prerelease', phase: 'installing' }; await updates.save(true);
  const replacement = new Updates({ manager: updates.manager, profileDir: dir, runtime: RUNTIME });
  replacement.operation = { id: second, version: '0.1.0-alpha.6', channel: 'prerelease', phase: 'installing' }; await replacement.save(true);
  updates.operation.result = { application: 'failed', stage: 'install' }; updates.operation.phase = 'failed'; await updates.save();
  assert.equal(JSON.parse(await readFile(join(dir, '.dsh-cf-updates/latest.json'), 'utf8')).id, second);
  assert.equal((await replacement.status(second)).operation, second);
});
function clientController(storage = new Map()) {
  let plugin; const crypto = { randomUUID };
  const localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  return readFile('src/client.js', 'utf8').then(source => { vm.runInNewContext(source, { window: { __ModuleLoader__: { load: item => { plugin = item.factory(() => ({ createElement: () => {} })); } } }, crypto, localStorage, Set }); return { Controller: plugin.UpdateController, storage }; });
}
test('Client stores ID before its request, ignores stale replies and never resends after reconnect', async () => {
  const { Controller, storage } = await clientController(), requests = [];
  const client = new Controller({ rpc: { call: (_base, method, payload) => new Promise(resolve => { if (method === 'update-install') assert.equal(storage.get(`dsh.cf.update.${PROFILE_KEY}.operation`), payload.operationId); requests.push({ method, payload, resolve }); }) } });
  const initial = client.status(); requests[0].resolve({ ok: true, value: { status: 'available', profileKey: PROFILE_KEY, running: VERSION, channel: 'prerelease', candidate: { id: 'candidate', version: NEXT, notes: '', url: `https://github.com/${REPO}/releases/tag/v${NEXT}` } } }); await initial;
  const install = client.install(); await client.install();
  const status = client.status(); requests[2].resolve({ ok: true, value: { status: 'unknown', profileKey: PROFILE_KEY, running: VERSION, channel: 'prerelease', operation: requests[1].payload.operationId } }); await status;
  requests[1].resolve({ ok: true, value: { status: 'confirmed', profileKey: PROFILE_KEY, running: NEXT, channel: 'prerelease' } }); await install;
  assert.equal(client.view.status, 'unknown'); assert.equal(requests.filter(item => item.method === 'update-install').length, 1); client.dispose();
});
test('Client changes profile identity before restoring an operation or channel from browser storage', async () => {
  const oldKey = 'a'.repeat(64), newKey = 'b'.repeat(64), oldId = randomUUID(), storage = new Map([[`dsh.cf.update.${oldKey}.operation`, oldId], [`dsh.cf.update.${oldKey}.channel`, 'stable']]);
  const { Controller } = await clientController(storage); let key = oldKey; const requests = [];
  const client = new Controller({ rpc: { call: async (_base, method, payload) => { requests.push({ method, payload, key }); return { ok: true, value: { status: payload.operationId ? 'unknown' : 'idle', operation: payload.operationId, profileKey: key, running: VERSION, channel: 'prerelease' } }; } } });
  await client.status(); assert.equal(requests[0].payload.operationId, undefined); assert.equal(requests[1].payload.operationId, oldId); assert.equal(client.view.status, 'unknown');
  key = newKey; await client.status();
  assert.equal(requests.at(-1).payload.operationId, undefined); assert.equal(client.view.status, 'idle'); assert.equal(client.channel, 'prerelease'); assert.equal(client.operation, null);
  await client.check(); assert.equal(requests.at(-1).method, 'update-check'); assert.equal(storage.get(`dsh.cf.update.${oldKey}.operation`), oldId); client.dispose();
});
test('An authoritative failure before admission clears the Client attempt rather than orphaning its UUID', async () => {
  const { Controller, storage } = await clientController(); let calls = 0;
  const client = new Controller({ rpc: { call: async (_base, method, payload) => { calls++; if (method === 'update-install') return { ok: true, value: { status: 'failed', profileKey: PROFILE_KEY, running: VERSION, channel: 'prerelease', reason: 'UPDATE_CANDIDATE' } }; return { ok: true, value: { status: 'available', profileKey: PROFILE_KEY, running: VERSION, channel: 'prerelease', candidate: { id: 'candidate', version: NEXT, notes: '', url: `https://github.com/${REPO}/releases/tag/v${NEXT}` } } }; } } });
  await client.status(); await client.install(); assert.equal(client.view.status, 'failed'); assert.equal(client.operation, null); assert.equal(storage.get(`dsh.cf.update.${PROFILE_KEY}.operation`), undefined); await client.status(); assert.equal(client.view.status, 'available'); assert.equal(calls, 3); client.dispose();
});
test('Late reconciliation of an old request cannot corrupt a newer in-progress receipt', async t => {
  let settleOld, settleNew, announceNew;
  const begun = new Promise(resolve => { announceNew = resolve; });
  const { updates, dir } = await fixture(t, { manager: { waitForInstall: async () => new Promise(resolve => { settleOld = resolve; }), installBundle: async () => { announceNew(); return new Promise(resolve => { settleNew = resolve; }); } } });
  const oldId = randomUUID(), nextId = randomUUID();
  updates.operation = { id: oldId, version: NEXT, channel: 'prerelease', phase: 'unknown' }; await updates.save(true);
  const observing = updates.status(oldId); while (!settleOld) await new Promise(resolve => setImmediate(resolve));
  const writer = new Updates({ manager: updates.manager, profileDir: dir, runtime: RUNTIME });
  writer.operation = { id: oldId, version: NEXT, channel: 'prerelease', phase: 'failed', result: { application: 'failed', stage: 'install' } }; await writer.save();
  const checked = await updates.check('prerelease'), installing = updates.install(checked.candidate.id, nextId, 'prerelease', updates.profileKey); await begun;
  settleOld({ application: 'failed', stage: 'install' }); await observing;
  assert.equal(updates.operation.id, nextId); assert.equal(updates.operation.result, undefined);
  assert.equal(JSON.parse(await readFile(join(dir, '.dsh-cf-updates', `${nextId}.json`), 'utf8')).result, undefined);
  settleNew({ application: 'failed', stage: 'install' }); await installing;
});
test('Authoritative latest Host operation replaces a stale cached receipt', async () => {
  const stale = randomUUID(), active = randomUUID(), storage = new Map([[`dsh.cf.update.${PROFILE_KEY}.operation`, stale]]);
  const { Controller } = await clientController(storage), requests = [];
  const client = new Controller({ rpc: { call: async (_base, method, payload) => { requests.push(payload); return { ok: true, value: { status: 'installing', profileKey: PROFILE_KEY, running: VERSION, channel: 'prerelease', operation: active } }; } } });
  await client.status(); await client.status();
  assert.equal(requests.length, 2); assert(requests.every(payload => !payload.operationId)); assert.equal(client.operation, active); assert.equal(storage.get(`dsh.cf.update.${PROFILE_KEY}.operation`), active); client.dispose();
});
test('An install bound to a different profile is rejected before any manager action', async t => {
  const { updates, calls } = await fixture(t), checked = await updates.check('prerelease');
  await assert.rejects(updates.install(checked.candidate.id, randomUUID(), 'prerelease', 'b'.repeat(64)), { code: 'UPDATE_PROFILE' });
  assert.equal(calls.length, 0); assert.equal(updates.operation, null);
});
test('Nominal success requires a valid writable installed bundle inventory', async t => {
  for (const invalid of [{ installed: false }, { error: { code: 'INVALID_BUNDLE' } }, { readOnlyReason: 'locked' }]) {
    const { updates, bundle, manager } = await fixture(t);
    manager.installBundle = async () => { Object.assign(bundle, invalid, { version: NEXT }); return { application: 'restart-required', stage: 'install', bundle: 'dsh-cf', version: NEXT }; };
    const checked = await updates.check('prerelease');
    assert.equal((await updates.install(checked.candidate.id, randomUUID(), 'prerelease', updates.profileKey)).status, 'unknown');
  }
});
test('Reload after the first install reply is lost reconciles its scoped ID without resending', async () => {
  const storage = new Map(), { Controller } = await clientController(storage), requests = [];
  const available = { status: 'available', profileKey: PROFILE_KEY, running: VERSION, channel: 'prerelease', candidate: { id: 'candidate', version: NEXT, notes: '', url: `https://github.com/${REPO}/releases/tag/v${NEXT}` } };
  const first = new Controller({ rpc: { call: async (_base, method, payload) => { requests.push({ method, payload }); if (method === 'update-install') throw Error('lost'); return { ok: true, value: available }; } } });
  await first.status(); await first.install(); const id = first.operation; first.dispose();
  const next = new Controller({ rpc: { call: async (_base, method, payload) => { requests.push({ method, payload }); return { ok: true, value: { status: payload.operationId ? 'unknown' : 'idle', operation: payload.operationId, profileKey: PROFILE_KEY, running: VERSION, channel: 'prerelease' } }; } } });
  await next.status(); assert.equal(next.operation, id); assert.equal(next.view.status, 'unknown'); assert.equal(requests.at(-1).payload.operationId, id); assert.equal(requests.filter(item => item.method === 'update-install').length, 1); next.dispose();
});

test('HMR already-installed installs the same tag through a different git URL and does not remove this plugin', async t => {
  const removed = [];
  const { updates, calls, bundle } = await fixture(t, { manager: {
    removeBundle: async () => { removed.push('remove'); throw new Error('must not remove'); },
    installBundle: async (spec, config) => {
      calls.push({ spec, config });
      if (spec.startsWith('github:')) return { application: 'failed', stage: 'install', error: { code: 'already-installed' } };
      bundle.version = NEXT; bundle.source = spec;
      return { application: 'restart-required', stage: 'install', bundle: 'dsh-cf', version: NEXT };
    },
  } });
  const checked = await updates.check('prerelease');
  const view = await updates.install(checked.candidate.id, randomUUID(), 'prerelease', updates.profileKey);
  assert.equal(view.status, 'restart-required');
  assert.deepEqual(calls.map(call => call.spec), releaseSpecs(`v${NEXT}`));
  assert.equal(calls[0].config.requestId, calls[1].config.requestId);
  assert.equal(calls[1].config.enabled, false);
  assert.equal(supportsSource(bundle.source), true);
  assert.deepEqual(removed, []);
});
test('already-installed reconciles when the release is on disk and refuses a newer install or a repeated refusal without removal', async t => {
  const removed = [];
  let installs = 0;
  const present = await fixture(t, { manager: {
    removeBundle: async () => { removed.push('remove'); },
    installBundle: async () => { installs++; present.bundle.version = NEXT; return { application: 'failed', stage: 'install', error: { code: 'already-installed' } }; },
  }, core: { version: NEXT } });
  let checked = await present.updates.check('prerelease');
  assert.equal((await present.updates.install(checked.candidate.id, randomUUID(), 'prerelease', present.updates.profileKey)).status, 'confirmed');
  assert.equal(installs, 1);
  const ahead = await fixture(t, { manager: {
    removeBundle: async () => { removed.push('remove'); },
    installBundle: async (spec) => { ahead.calls.push(spec); ahead.bundle.version = '0.1.0-alpha.9'; return { application: 'failed', stage: 'install', error: { code: 'already-installed' } }; },
  } });
  checked = await ahead.updates.check('prerelease');
  assert.equal((await ahead.updates.install(checked.candidate.id, randomUUID(), 'prerelease', ahead.updates.profileKey)).reason, 'UPDATE_CANDIDATE');
  assert.equal(ahead.calls.length, 1);
  const blocked = await fixture(t, { manager: {
    removeBundle: async () => { removed.push('remove'); },
    installBundle: async (spec) => { blocked.calls.push(spec); return { application: 'failed', stage: 'install', error: { code: 'already-installed' } }; },
  } });
  checked = await blocked.updates.check('prerelease');
  const refused = await blocked.updates.install(checked.candidate.id, randomUUID(), 'prerelease', blocked.updates.profileKey);
  assert.equal(refused.status, 'failed'); assert.equal(refused.reason, 'UPDATE_ALREADY_INSTALLED');
  assert.deepEqual(blocked.calls, releaseSpecs(`v${NEXT}`));
  assert.deepEqual(removed, []);
});
test('A rejected delayed profile install clears its unadmitted browser ID', async () => {
  const { Controller, storage } = await clientController();
  const client = new Controller({ rpc: { call: async (_base, method) => method === 'update-install' ? { ok: false, error: { code: 'UPDATE_PROFILE' } } : { ok: true, value: { status: 'available', profileKey: PROFILE_KEY, running: VERSION, channel: 'prerelease', candidate: { id: 'candidate', version: NEXT, notes: '', url: `https://github.com/${REPO}/releases/tag/v${NEXT}` } } } } });
  await client.status(); await client.install(); assert.equal(client.operation, null); assert.equal(storage.size, 0); client.dispose();
});
