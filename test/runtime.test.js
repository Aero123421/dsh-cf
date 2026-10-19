import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, stat, rm, mkdir, utimes, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store, fingerprint, fingerprintV2, readMachineId } from '../src/store.js';
import { connectorToken, tokenSecret } from './helpers.js';
import { ensureBinary, childEnv, supportedVersion, connectorArgs, Connector, CLOUDFLARED_VERSION, MINIMUM_VERSION } from '../src/connector.js';
async function directory(t) { const dir = await mkdtemp(join(tmpdir(), 'dsh-cf-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
test('state is private, persists without credentials, and active profile locks are exclusive', async t => {
  const dir = await directory(t); const store = await new Store(dir).open(); t.after(() => store.close());
  await assert.rejects(new Store(dir).open(), { code: 'LOCK' });
  const token = connectorToken({ secret: tokenSecret('connector-private-secret') });
  store.state.gatePort = 4321; await store.save(); await store.writeToken(token);
  if (process.platform !== 'win32') { assert.equal((await stat(join(dir, 'tunnel.token'))).mode & 0o777, 0o600); assert.equal((await stat(dir)).mode & 0o777, 0o700); }
  const state = await readFile(join(dir, 'state.json'), 'utf8');
  assert(!state.includes(token)); assert(!state.includes('connector-private'));
  const id = store.state.instanceId; await store.close(); const reopened = await new Store(dir).open(); t.after(() => reopened.close());
  assert.equal(reopened.state.instanceId, id); assert.equal(reopened.state.gatePort, 4321);
});
test('a corrupt state is never reset into a fresh public instance', async t => {
  const dir = await directory(t); await writeFile(join(dir, 'state.json'), '{not-json');
  await assert.rejects(new Store(dir).open(), { code: 'STATE_CORRUPT' }); assert.equal(await readFile(join(dir, 'state.json'), 'utf8'), '{not-json');
});
const noMachineId = async () => null;
test('a changed host identity loads safely: publication stays off, the auto-connect preference is kept, and confirming does not restore anything else', async t => {
  const dir = await directory(t); const store = await new Store(dir, { machineId: noMachineId }).open(); const original = store.state.machine;
  store.state.machine = 'another-machine'; store.state.autoConnect = true; store.state.proven = true; store.state.setup = { hostname: 'keep.example.com' }; await store.save(); await store.close();
  const reopened = await new Store(dir, { machineId: noMachineId }).open();
  assert(reopened.state.hostReview?.at); assert.equal(reopened.state.autoConnect, true, 'a review no longer persists autoConnect=false'); assert.equal(reopened.state.setup.hostname, 'keep.example.com');
  await reopened.confirmHost(); assert.equal(reopened.state.hostReview, null); assert.equal(reopened.state.machine, original); assert.equal(reopened.state.autoConnect, true);
  assert(reopened.state.acceptedMachines.includes('another-machine') && reopened.state.acceptedMachines.includes(original));
  await reopened.close(); const again = await new Store(dir, { machineId: noMachineId }).open(); t.after(() => again.close());
  assert.equal(again.state.hostReview, null);
});
test('the stable machine identity survives a hostname change, and a legacy state is upgraded to it without a review', async t => {
  const dir = await directory(t); const id = 'f'.repeat(32);
  const store = await new Store(dir, { machineId: async () => id }).open();
  assert.equal(store.state.machineV2, await fingerprintV2(async () => id));
  // Simulate the hostname-based value drifting (macOS renames the host per network).
  store.state.machine = 'old-hostname-value'; await store.save(); await store.close();
  const same = await new Store(dir, { machineId: async () => id }).open();
  assert.equal(same.state.hostReview, undefined, 'the same machine under another hostname is not a new host'); await same.close();
  // A state written before the stable identity existed carries only the legacy value of this machine.
  const raw = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')); delete raw.machineV2; raw.machine = fingerprint();
  await writeFile(join(dir, 'state.json'), JSON.stringify(raw));
  const upgraded = await new Store(dir, { machineId: async () => id }).open();
  assert.equal(upgraded.state.hostReview, undefined); assert.equal(upgraded.state.machineV2, await fingerprintV2(async () => id));
  await upgraded.close();
  // A machine with another stable id is another machine, even if its hostname happens to match the saved value.
  const other = await new Store(dir, { machineId: async () => 'e'.repeat(32) }).open(); t.after(() => other.close());
  assert(other.state.hostReview?.at);
  await other.confirmHost(); await other.close();
  const remembered = await new Store(dir, { machineId: async () => id }).open(); t.after(() => remembered.close());
  assert(!remembered.state.hostReview, 'both confirmed machines are remembered');
});
test('a copied profile on a machine with another stable id requires review; unreadable ids fall back to the hostname value', async t => {
  const dir = await directory(t);
  const first = await new Store(dir, { machineId: async () => 'a'.repeat(32) }).open();
  first.state.machine = 'copied-from-elsewhere'; await first.save(); await first.close();
  const copy = await new Store(dir, { machineId: async () => 'b'.repeat(32) }).open();
  assert(copy.state.hostReview?.at); await copy.close();
  const fallback = await new Store(await directory(t), { machineId: async () => { throw new Error('ioreg failed'); } }).open(); t.after(() => fallback.close());
  assert.equal(fallback.state.hostReview, undefined); assert.equal(fallback.state.machineV2, undefined);
});
test('state validates the new optional fields', async t => {
  for (const patch of [{ machineV2: 'short' }, { paused: 'yes' }, { trustedHostAdded: { hostname: 'x' } }, { trustedHostAdded: { hostname: 'x', form: 'array', created: 'no' } }]) {
    const dir = await directory(t), store = await new Store(dir, { machineId: noMachineId }).open();
    Object.assign(store.state, patch); await store.save(); await store.close();
    await assert.rejects(new Store(dir).open(), { code: 'STATE_CORRUPT' }, JSON.stringify(patch));
  }
  const dir = await directory(t), store = await new Store(dir).open();
  Object.assign(store.state, { paused: true, trustedHostAdded: { hostname: 'x.example.com', form: 'expr', created: false } }); await store.save(); await store.close();
  const ok = await new Store(dir).open(); t.after(() => ok.close()); assert.equal(ok.state.paused, true);
});
test('on Linux two containers that share one image machine id stay distinct by hostname; macOS ignores hostname drift', async () => {
  const id = async () => 'c'.repeat(32);
  assert.notEqual(await fingerprintV2(id, { platform: 'linux', host: 'container-a' }), await fingerprintV2(id, { platform: 'linux', host: 'container-b' }));
  assert.equal(await fingerprintV2(id, { platform: 'darwin', host: 'MacBook.local' }), await fingerprintV2(id, { platform: 'darwin', host: 'MacBook-2.local' }));
  assert.equal(await fingerprintV2(id, { platform: 'win32', host: 'PC-1' }), await fingerprintV2(id, { platform: 'win32', host: 'PC-2' }));
});
test('the platform machine id is read where it is cheaply available', async () => {
  const id = await readMachineId();
  if (process.platform === 'linux') assert(id === null || /^[a-f0-9]{32}$/.test(id));
  assert(await fingerprintV2() === null || /^[a-f0-9]{64}$/.test(await fingerprintV2()));
});
test('a previously confirmed host identity is accepted again without a new review', async t => {
  const dir = await directory(t); const store = await new Store(dir, { machineId: noMachineId }).open(); const current = store.state.machine;
  store.state.machine = 'flipped-hostname'; store.state.acceptedMachines = ['flipped-hostname', current]; await store.save(); await store.close();
  const reopened = await new Store(dir, { machineId: noMachineId }).open(); t.after(() => reopened.close()); assert.equal(reopened.state.hostReview, undefined);
});
test('a stale lock is reclaimed without stealing a live new lock', async t => {
  const dir = await directory(t); await writeFile(join(dir, 'owner.lock'), JSON.stringify({ pid: 2147483647, nonce: 'old', heartbeatMs: 50 }));
  const store = await new Store(dir, { heartbeatMs: 50 }).open(); t.after(() => store.close());
  assert.notEqual(JSON.parse(await readFile(join(dir, 'owner.lock'))).nonce, 'old'); await assert.rejects(new Store(dir).open(), { code: 'LOCK' });
});
// A live owner refreshes owner.lock's mtime every heartbeat; tests use a short heartbeat.
const beat = (t, path, ms = 20) => { const timer = setInterval(() => { const now = new Date(); utimes(path, now, now).catch(() => {}); }, ms); t.after(() => clearInterval(timer)); };
test('a lock with our PID but no heartbeat (crashed run, container restart) is reclaimed after one observation', async t => {
  const dir = await directory(t); await writeFile(join(dir, 'owner.lock'), JSON.stringify({ pid: process.pid, nonce: 'previous-container-run', heartbeatMs: 50 }));
  const started = Date.now(); const store = await new Store(dir, { heartbeatMs: 50 }).open(); t.after(() => store.close());
  assert.notEqual(JSON.parse(await readFile(join(dir, 'owner.lock'))).nonce, 'previous-container-run'); assert(Date.now() - started >= 70);
});
test('a long-silent lock is reclaimed after observation even if its PID now belongs to another process', async t => {
  const dir = await directory(t); const { spawn } = await import('node:child_process');
  const other = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }); t.after(() => other.kill('SIGKILL'));
  const path = join(dir, 'owner.lock'); await writeFile(path, JSON.stringify({ pid: other.pid, nonce: 'reused-pid', heartbeatMs: 50 }));
  const old = new Date(Date.now() - 60_000); await utimes(path, old, old);
  const store = await new Store(dir, { heartbeatMs: 50 }).open(); t.after(() => store.close());
  assert.notEqual(JSON.parse(await readFile(path)).nonce, 'reused-pid');
});
test('a heartbeating lock is refused for live, equal and nonexistent PIDs (other PID namespaces)', async t => {
  const dir = await directory(t); const { spawn } = await import('node:child_process');
  const other = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }); t.after(() => other.kill('SIGKILL'));
  const path = join(dir, 'owner.lock'); beat(t, path);
  for (const pid of [other.pid, process.pid, 2147483647]) {
    await writeFile(path, JSON.stringify({ pid, nonce: `live-${pid}`, heartbeatMs: 50 }));
    await assert.rejects(new Store(dir, { heartbeatMs: 50 }).open(), { code: 'LOCK' });
    assert.equal(JSON.parse(await readFile(path)).nonce, `live-${pid}`);
  }
});
test('ownership loss stops lease renewal and refuses persistent state/token writes', async t => {
  const dir = await directory(t); const store = await new Store(dir, { heartbeatMs: 20 }).open(); t.after(() => store.close());
  let lost = 0; store.onOwnershipLost = () => { lost++; };
  const path = join(dir, 'owner.lock'); await rm(path); await writeFile(path, JSON.stringify({ pid: process.pid, nonce: 'new-owner', heartbeatMs: 20 }));
  const mtime = (await stat(path)).mtimeMs;
  for (let i = 0; !lost && i < 100; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(lost, 1); assert.equal(store.ownershipLost, true); assert.equal((await stat(path)).mtimeMs, mtime);
  const original = await readFile(join(dir, 'state.json'), 'utf8'); store.state.gatePort = 9876;
  await assert.rejects(store.save(), { code: 'LOCK' });
  await assert.rejects(store.writeToken(connectorToken({ secret: tokenSecret('must-not-land') })), { code: 'LOCK' });
  await assert.rejects(store.clearToken(), { code: 'LOCK' });
  assert.equal(await readFile(join(dir, 'state.json'), 'utf8'), original);
  await store.close(); assert.equal(JSON.parse(await readFile(path, 'utf8')).nonce, 'new-owner');
});
test('a transient I/O failure of the lease refresh is not an ownership loss, but a replaced or removed lock is, and so are repeated failures', async t => {
  const dir = await directory(t); const store = await new Store(dir, { heartbeatMs: 10_000, leaseFailureLimit: 3 }).open(); t.after(() => store.close());
  let lost = 0; store.onOwnershipLost = () => { lost++; };
  const path = join(dir, 'owner.lock'), good = await readFile(path, 'utf8');
  await writeFile(path, '{partial'); await store.refreshLease(); await store.refreshLease();
  assert.equal(store.ownershipLost, false); assert.equal(lost, 0);
  await writeFile(path, good); await store.refreshLease(); assert.equal(store.leaseFailures, 0, 'a good refresh resets the count');
  await writeFile(path, '{partial'); for (let i = 0; i < 3; i++) await store.refreshLease();
  await new Promise(r => setImmediate(r)); assert.equal(store.ownershipLost, true); assert.equal(lost, 1);
  const gone = await new Store(await directory(t), { heartbeatMs: 10_000 }).open(); t.after(() => gone.close());
  await rm(join(gone.dir, 'owner.lock')); await gone.refreshLease(); assert.equal(gone.ownershipLost, true);
});
test('a state write during a transient lock read failure is refused without declaring ownership lost', async t => {
  const dir = await directory(t); const store = await new Store(dir, { heartbeatMs: 10_000 }).open(); t.after(() => store.close());
  const path = join(dir, 'owner.lock'), good = await readFile(path, 'utf8');
  await writeFile(path, '{partial');
  await assert.rejects(store.save(), { code: 'LOCK' }); assert.equal(store.ownershipLost, false);
  await writeFile(path, good); await store.save();
});
test('a reclaim.lock directory left by a crash blocks only until it is stale', async t => {
  const dir = await directory(t); await writeFile(join(dir, 'owner.lock'), JSON.stringify({ pid: 1, nonce: 'dead', heartbeatMs: 40 }));
  const reclaim = join(dir, 'reclaim.lock'); await mkdir(reclaim);
  await assert.rejects(new Store(dir, { heartbeatMs: 40 }).open(), { code: 'LOCK' });
  const old = new Date(Date.now() - 5 * 60_000); await utimes(reclaim, old, old);
  const store = await new Store(dir, { heartbeatMs: 40 }).open(); t.after(() => store.close());
  assert.notEqual(JSON.parse(await readFile(join(dir, 'owner.lock'))).nonce, 'dead');
  await assert.rejects(stat(reclaim), { code: 'ENOENT' });
});
test('changing lock identity during reclamation preserves the replacement owner', async t => {
  const dir = await directory(t), path = join(dir, 'owner.lock');
  await writeFile(path, JSON.stringify({ pid: 2147483647, nonce: 'old-owner', heartbeatMs: 50 }));
  const opening = new Store(dir, { heartbeatMs: 50 }).open(); const rejected = assert.rejects(opening, { code: 'LOCK' });
  await new Promise(r => setTimeout(r, 20)); await writeFile(path, JSON.stringify({ pid: process.pid, nonce: 'replacement-owner', heartbeatMs: 50 }));
  await rejected; assert.equal(JSON.parse(await readFile(path, 'utf8')).nonce, 'replacement-owner');
});
for (const kind of ['state', 'token']) test(`ownership loss while staging a ${kind} write prevents its commit`, async t => {
  const dir = await directory(t), store = await new Store(dir).open(); t.after(() => store.close());
  await store.writeToken(connectorToken({ secret: tokenSecret('original-private') }));
  const path = join(dir, kind === 'state' ? 'state.json' : 'tunnel.token'); const original = await readFile(path, 'utf8');
  const handle = await open(path, 'r'), prototype = Object.getPrototypeOf(handle), sync = prototype.sync; await handle.close();
  let entered, release; const staging = new Promise(r => { entered = r; }), waiting = new Promise(r => { release = r; }); t.after(() => release());
  t.mock.method(prototype, 'sync', async function () { entered(); await waiting; return sync.call(this); });
  store.state.gatePort = 5678;
  const writing = kind === 'state' ? store.save() : store.writeToken(connectorToken({ secret: tokenSecret('replacement-old-owner') }));
  const rejected = assert.rejects(writing, { code: 'LOCK' });
  await staging;
  await rm(join(dir, 'owner.lock')); await writeFile(join(dir, 'owner.lock'), JSON.stringify({ pid: process.pid, nonce: 'replacement-owner', heartbeatMs: 50 }));
  await store.refreshLease(); assert.equal(store.ownershipLost, true);
  release(); await rejected;
  assert.equal(await readFile(path, 'utf8'), original);
});
test('an open store keeps its lease alive so a second process would see a heartbeat', async t => {
  const dir = await directory(t); const store = await new Store(dir, { heartbeatMs: 30 }).open(); t.after(() => store.close());
  const path = join(dir, 'owner.lock'); const old = new Date(Date.now() - 60_000); await utimes(path, old, old);
  await new Promise(r => setTimeout(r, 120)); assert((await stat(path)).mtimeMs > Date.now() - 1_000);
});
test('closing releases in-process ownership so a reloaded plugin can reopen the profile', async t => {
  const dir = await directory(t); const first = await new Store(dir).open(); await first.close();
  const second = await new Store(dir).open(); t.after(() => second.close()); assert.ok(second.state.instanceId);
});
test('connector environment excludes API keys, injection flags, and shared tunnel config', () => {
  assert.deepEqual(childEnv({ PATH: '/bin', HOME: '/home/test', OPENAI_API_KEY: 'SECRET', CLOUDFLARE_API_TOKEN: 'SECRET', TUNNEL_TOKEN: 'SECRET', NODE_OPTIONS: '--require bad' }), { PATH: '/bin', HOME: '/home/test' });
});
test('cloudflared 2025.6.1 is the minimum: JSON log output is required to observe registration', () => {
  assert.equal(MINIMUM_VERSION, '2025.6.1');
  for (const v of ['2025.6.1', '2025.6.2', '2025.10.0', '2026.1.0', CLOUDFLARED_VERSION]) assert(supportedVersion(`cloudflared version ${v} (built x)`), v);
  for (const v of ['2025.6.0', '2025.5.9', '2025.4.0', '2024.12.9']) assert(!supportedVersion(`cloudflared version ${v}`), v);
  assert(!supportedVersion('not cloudflared'));
});
test('connector argv uses only flags that exist in cloudflared (--output json, not --logformat)', () => {
  const args = connectorArgs('/tmp/x/config.yml', '/state/tunnel.token');
  assert.deepEqual(args, ['--no-autoupdate', 'tunnel', '--config', '/tmp/x/config.yml', '--metrics', '127.0.0.1:0', '--output', 'json', 'run', '--token-file', '/state/tunnel.token']);
  assert(!args.includes('--logformat')); assert(!args.some(a => a.includes('connector-secret')));
});
// Opt-in check against a real cloudflared binary: DSH_CF_CLOUDFLARED=/path/to/cloudflared npm test
test('real cloudflared accepts the exact connector flags', { skip: process.env.DSH_CF_CLOUDFLARED ? false : 'Set DSH_CF_CLOUDFLARED to a cloudflared binary to run' }, async t => {
  const { spawnSync } = await import('node:child_process');
  const binary = process.env.DSH_CF_CLOUDFLARED; const dir = await directory(t);
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8' }); assert(supportedVersion(version.stdout), version.stdout);
  await writeFile(join(dir, 'config.yml'), '{}\n'); await writeFile(join(dir, 'tunnel.token'), 'not-a-valid-token-for-flag-parsing-only');
  // A syntactically invalid token makes cloudflared stop after argument parsing, without any network use.
  const r = spawnSync(binary, connectorArgs(join(dir, 'config.yml'), join(dir, 'tunnel.token')), { encoding: 'utf8', timeout: 20_000, env: childEnv() });
  const output = `${r.stdout}${r.stderr}`;
  assert.doesNotMatch(output, /flag provided but not defined|Incorrect Usage/); assert.match(output, /Provided Tunnel token is not valid/);
});
const unix = process.platform === 'win32' ? { skip: 'Unix executable fixture' } : {};
test('selected compatible installed binary is reused without downloads or mutation', unix, async t => {
  const dir = await directory(t); const binary = join(dir, 'cloudflared'); const script = '#!/bin/sh\necho "cloudflared version 2026.10.0 (fixture)"\n'; await writeFile(binary, script, { mode: 0o700 });
  const result = await ensureBinary({ dir, selected: binary, fetchImpl: () => { throw new Error('must not download'); } });
  assert.equal(result.path, binary); assert.equal(result.source, 'selected'); assert.equal(await readFile(binary, 'utf8'), script);
});
test('old selected binary is rejected and never upgraded', unix, async t => {
  const dir = await directory(t), binary = join(dir, 'old'); const source = '#!/bin/sh\necho "cloudflared version 2024.1.0"\n'; await writeFile(binary, source, { mode: 0o700 });
  await assert.rejects(ensureBinary({ dir, selected: binary }), { code: 'BINARY_OLD' }); assert.equal(await readFile(binary, 'utf8'), source);
});
test('official-download integrity mismatch is rejected before any executable runs', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async t => {
  const dir = await directory(t); const bytes = Buffer.from('#!/bin/sh\ntouch SHOULD-NEVER-EXECUTE\n');
  const name = 'cloudflared-linux-amd64'; let calls = 0;
  const mock = async () => ++calls === 1 ? Response.json({ tag_name: CLOUDFLARED_VERSION, assets: [{ name, digest: `sha256:${'0'.repeat(64)}`, size: bytes.length, browser_download_url: `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${name}` }] }) : new Response(bytes);
  await assert.rejects(ensureBinary({ dir, allowDownload: true, fetchImpl: mock }), { code: 'DOWNLOAD_INTEGRITY' }); assert.equal(calls, 2);
});
test('managed cache checksum is verified again before execution', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async t => {
  const dir = await directory(t), cache = join(dir, 'bin', CLOUDFLARED_VERSION); await mkdir(cache, { recursive: true });
  await writeFile(join(cache, 'cloudflared'), '#!/bin/sh\necho HACKED\n', { mode: 0o700 }); await writeFile(join(cache, 'binary.sha256'), createHash('sha256').update('different').digest('hex'));
  await assert.rejects(ensureBinary({ dir, allowDownload: true }), { code: 'BINARY_INTEGRITY' });
});
test('guardian starts a real fixture child with the exact argv and stops only that child', unix, async t => {
  const dir = await directory(t), binary = join(dir, 'cloudflared'), pidFile = join(dir, 'pid'), argvFile = join(dir, 'argv');
  // The fixture behaves like cloudflared's flag parser: an unknown flag is a usage error and exit, as the real binary does.
  await writeFile(binary, `#!/usr/bin/env node\nconst fs=require('fs');const a=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(argvFile)},JSON.stringify(a));\nif(a.includes('--logformat')){console.error('Incorrect Usage. flag provided but not defined: -logformat');process.exit(0);}\nfs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));\nconsole.error(JSON.stringify({level:'info',message:'Registered tunnel connection',connIndex:0}));\nsetInterval(()=>{},1000);\n`, { mode: 0o700 });
  const statuses = []; const connector = new Connector(s => statuses.push(s)); t.after(() => connector.stop());
  const tokenFile = join(dir, 'tunnel.token');
  await connector.start(binary, tokenFile);
  for (let i = 0; !statuses.includes('connected') && !statuses.includes('error') && i < 150; i++) await new Promise(r => setTimeout(r, 20));
  assert(statuses.includes('connected'), statuses.join(','));
  const argv = JSON.parse(await readFile(argvFile, 'utf8'));
  assert.deepEqual(argv, connectorArgs(argv[3], tokenFile)); assert.match(argv[3], /config\.yml$/);
  const pid = Number(await readFile(pidFile));
  await connector.stop(); assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }); assert.equal(statuses.at(-1), 'stopped'); assert(!statuses.includes('error'));
});
for (const scenario of [
  {
    name: 'partial HA connection failures keep the tunnel connected',
    events: [
      { message: 'Registered tunnel connection', connIndex: 0 },
      { message: 'Registered tunnel connection', connIndex: 1 },
      { message: 'Retrying connection in up to 1s', connIndex: 2 },
      { message: 'Unregistered tunnel connection', connIndex: 0 },
      { message: 'Retrying connection in up to 1s', connIndex: 0 },
    ],
    expected: ['connected', 'connected', 'connected', 'connected', 'connected'],
  },
  {
    name: 'all HA connections must disconnect before reporting disconnected, and registration recovers',
    events: [
      { message: 'Registered tunnel connection', connIndex: 0 },
      { message: 'Registered tunnel connection', connIndex: 0 },
      { message: 'Registered tunnel connection', connIndex: 1 },
      { message: 'Unregistered tunnel connection', connIndex: 0 },
      { message: 'Unregistered tunnel connection', connIndex: 1 },
      { message: 'Retrying connection in up to 1s', connIndex: 1 },
      { message: 'Registered tunnel connection', connIndex: 1 },
    ],
    expected: ['connected', 'connected', 'connected', 'connected', 'disconnected', 'disconnected', 'connected'],
  },
  {
    name: 'missing or malformed connection indexes cannot change observed connectivity',
    events: [
      null,
      { message: 'Registered tunnel connection' },
      { message: 'Registered tunnel connection', connIndex: '0' },
      { message: 'Registered tunnel connection', connIndex: -1 },
      { message: 'Registered tunnel connection', connIndex: 0.5 },
      { message: 'Registered tunnel connection', connIndex: 0, token: 'fixture-secret-never-forward' },
      { message: 'Unregistered tunnel connection' },
      { message: 'Retrying connection in up to 1s', connIndex: '0' },
      { message: 'Unregistered tunnel connection', connIndex: 0 },
    ],
    expected: ['connected', 'disconnected'],
  },
]) test(`guardian: ${scenario.name}`, unix, async t => {
  const dir = await directory(t), binary = join(dir, 'ha-cloudflared');
  await writeFile(binary, `#!/usr/bin/env node\nfor(const event of ${JSON.stringify(scenario.events)}) console.error(JSON.stringify(event));\nsetTimeout(()=>process.exit(0),100);\n`, { mode: 0o700 });
  const statuses = [], messages = [], connector = new Connector(s => statuses.push(s)); t.after(() => connector.stop());
  await connector.start(binary, join(dir, 'tunnel.token'));
  connector.process.on('message', message => messages.push(message));
  // Wait for process exit so every preceding log/IPC event has been observed, including
  // invalid events that must not manufacture a connected or disconnected status.
  for (let i = 0; connector.process && i < 300; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(connector.process, null);
  assert(statuses.includes('error'), 'the fixture has exited');
  assert.deepEqual(statuses.slice(0, statuses.indexOf('error')), ['starting', ...scenario.expected]);
  assert(messages.every(message => Object.keys(message).sort().join(',') === 'status,type' && message.type === 'status'));
  assert(!JSON.stringify(messages).includes('fixture-secret-never-forward'));
});
for (const code of [0, 1]) test(`unexpected connector exit ${code} remains an error through guardian cleanup`, unix, async t => {
  const dir = await directory(t), binary = join(dir, 'exiting-cloudflared');
  await writeFile(binary, `#!/usr/bin/env node\nconsole.error(JSON.stringify({message:'Registered tunnel connection',connIndex:0}));setTimeout(()=>process.exit(${code}),50);\n`, { mode: 0o700 });
  const statuses = [], connector = new Connector(s => statuses.push(s)); t.after(() => connector.stop());
  await connector.start(binary, join(dir, 'tunnel.token'));
  for (let i = 0; connector.process && i < 200; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(connector.process, null); assert(statuses.includes('connected')); assert.equal(statuses.at(-1), 'error');
  assert(!statuses.slice(statuses.indexOf('error')).includes('stopped'));
});
test('a connector spawn failure is terminal rather than a normal stop', async t => {
  const dir = await directory(t), statuses = [], connector = new Connector(s => statuses.push(s)); t.after(() => connector.stop());
  await connector.start(join(dir, 'missing-cloudflared'), join(dir, 'tunnel.token'));
  for (let i = 0; connector.process && i < 200; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(connector.process, null); assert.equal(statuses.at(-1), 'error');
});


test('saved authentication mode survives reopen and legacy setups do not become Access-only', async t => {
  const { requiresWebAuthn } = await import('../src/cloudflare.js');
  for (const value of [undefined, true, false]) {
    const dir = await directory(t), store = await new Store(dir).open();
    store.state.setup = { hostname: 'keep.example.com' };
    if (value !== undefined) store.state.setup.requireWebAuthn = value;
    await store.save(); await store.close();
    const reopened = await new Store(dir).open();
    assert.equal(reopened.state.setup.requireWebAuthn, value);
    assert.equal(requiresWebAuthn(reopened.state.setup), value !== false);
    await reopened.close();
  }
});
test('corrupt authentication mode cannot silently disable WebAuthn', async t => {
  for (const value of ['false', null, 0]) {
    const dir = await directory(t), store = await new Store(dir).open();
    store.state.setup = { requireWebAuthn: value }; await store.save(); await store.close();
    await assert.rejects(new Store(dir).open(), { code: 'STATE_CORRUPT' });
  }
});
