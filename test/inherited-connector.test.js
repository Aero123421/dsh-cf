import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, utimes, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Store } from '../src/store.js';
import { Controller } from '../src/controller.js';
import { SETUP, AUD, connectorToken } from './helpers.js';

const OLD = { pid: 42, start: 100 };
const ledger = dir => join(dir, 'inherited-connector.json');
const readLedger = async dir => JSON.parse(await readFile(ledger(dir), 'utf8'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function profile(t, record = OLD) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cf-inherited-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new Store(dir).open();
  Object.assign(store.state, { setup: { ...SETUP }, owned: { audience: AUD, dnsId: 'dns' }, gatePort: 4567,
    autoConnect: true, lastConfigurationCheck: '2026-10-01T00:00:00.000Z' });
  await store.save(); await store.writeToken(connectorToken()); await store.close();
  await writeFile(join(dir, 'owner.lock'), JSON.stringify({ pid: 123, nonce: 'stale', heartbeatMs: 1, connector: record }));
  return dir;
}
/** Real Store/Controller/stopRecordedConnector, with no network, binary, or OS signals. */
async function runtime(t, dir, mode = 'unverified', overrides = {}) {
  const store = await new Store(dir).open();
  const signals = [], events = [];
  let clock = 0, reads = 0, starts = 0;
  const controller = new Controller({ store,
    adapter: { facts() {}, async trust() {}, invalidate() {} },
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' } }),
    dependencies: {
      ensureBinary: async () => ({ path: '/fixture/cloudflared', source: 'fixture', version: 'fixture' }),
      accessVerifier: async () => () => ({}),
      readProcessStart: async () => 200,
      Gate: class { async start() { events.push('gate.start'); return 4567; } async close() { events.push('gate.close'); } },
      Connector: class {
        constructor(status) { this.status = status; this.cloudflaredPid = 84; }
        async start() { starts++; events.push('connector.start'); this.status('connected'); }
        async stop() { events.push('connector.stop'); }
      },
      connectorIo: { platform: 'linux', exists: async () => mode !== 'gone' && !(mode === 'stopped' && signals.length),
        readFile: async path => {
          reads++;
          if (mode === 'unverified' || (mode === 'unverified-after-signal' && signals.length)) throw Object.assign(new Error('fixture denied'), { code: 'EACCES' });
          if (String(path).endsWith('/cmdline')) return 'cloudflared\0tunnel\0';
          return `42 (cloudflared) S ${Array(18).fill('0').join(' ')} ${mode === 'replaced' ? 999 : 100} 0\n`;
        },
        signalProcess: (_pid, signal) => signals.push(signal), now: () => clock, pause: async ms => { clock += ms; },
      },
      ...overrides,
    },
  });
  t.after(() => controller.dispose());
  const resume = async () => { await controller.handle('resume', {}, { management: true }); await controller.operation?.promise; };
  return { store, controller, resume, signals, events, get reads() { return reads; }, get starts() { return starts; } };
}

for (const mode of ['unverified', 'unverified-after-signal', 'stuck']) test(`unresolved ${mode} connector survives dispose, retry and a new Store/Controller`, async t => {
  const dir = await profile(t);
  const first = await runtime(t, dir, mode);
  await first.resume();
  assert.equal(first.controller.failure.code, 'LOCK'); assert.equal(first.starts, 0);
  assert.equal(first.controller.retry, null, 'LOCK must not retry automatically');
  await first.resume(); assert.equal(first.starts, 0, 'manual retry still checks the old process');
  await first.controller.dispose();
  const second = await runtime(t, dir, mode);
  await second.resume();
  assert.equal(second.starts, 0, 'restart must not forget the unresolved process');
  assert(second.reads > 0); assert.equal(second.controller.failure.code, 'LOCK');
  assert.deepEqual(await readLedger(dir), OLD);
  if (mode === 'unverified') assert.deepEqual([...first.signals, ...second.signals], []);
});

test('takeover persists the legacy record before a crash without close and before stopping it', async t => {
  const dir = await profile(t);
  // A child exits after acquisition, without Controller creation or Store.close().
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    import { Store } from ${JSON.stringify(new URL('../src/store.js', import.meta.url).href)};
    await new Store(process.argv[1], { heartbeatMs: 1 }).open(); process.exit(0);
  `, dir]);
  const next = await runtime(t, dir);
  await next.resume(); assert.equal(next.starts, 0); assert.equal(next.controller.failure.code, 'LOCK');
  assert.deepEqual(await readLedger(dir), OLD);
  if (process.platform !== 'win32') assert.equal((await stat(ledger(dir))).mode & 0o777, 0o600);
});

for (const mode of ['gone', 'stopped', 'replaced']) test(`confirmed ${mode} process releases the durable record and normal stop/restart still works`, async t => {
  const dir = await profile(t);
  const blocked = await runtime(t, dir); await blocked.resume(); await blocked.controller.dispose();
  const resolved = await runtime(t, dir, mode); await resolved.resume();
  assert.equal(resolved.starts, 1); assert.equal(resolved.controller.status(), 'online');
  assert.deepEqual(resolved.signals, mode === 'stopped' ? ['SIGTERM'] : []);
  await assert.rejects(readFile(ledger(dir)), { code: 'ENOENT' });
  assert.equal(resolved.store.inheritedConnector, null);
  await resolved.controller.dispose();
  assert(resolved.events.indexOf('connector.stop') < resolved.events.indexOf('gate.close'));
  const normal = await runtime(t, dir); await normal.resume(); assert.equal(normal.starts, 1);
});

test('cancel and unload during inherited process inspection retain the unresolved record', async t => {
  for (const action of ['cancel', 'dispose']) {
    const dir = await profile(t), entered = deferred(), finish = deferred();
    const f = await runtime(t, dir, 'unverified', { stopRecordedConnector: async (_record, { signal }) => {
      entered.resolve(); await finish.promise; signal.throwIfAborted(); return 'stopped';
    } });
    await f.controller.handle('resume', {}, { management: true }); await entered.promise;
    const pending = action === 'dispose' ? f.controller.dispose() : f.controller.cancel();
    await new Promise(r => setImmediate(r)); finish.resolve(); await pending;
    assert.equal(f.starts, 0); assert.deepEqual(await readLedger(dir), OLD);
    await f.controller.dispose();
    const next = await runtime(t, dir); await next.resume(); assert.equal(next.starts, 0);
  }
});

test('a missing legacy start time remains unresolved across unload', async t => {
  const record = { pid: 42, start: null }, dir = await profile(t, record);
  const f = await runtime(t, dir, 'replaced'); await f.resume(); await f.controller.dispose();
  const next = await runtime(t, dir, 'replaced'); await next.resume();
  assert.equal(next.starts, 0); assert.deepEqual(next.signals, []); assert.deepEqual(await readLedger(dir), record);
});

for (const gap of [false, true]) test(`recovery interrupted after preserving the record, ${gap ? 'without' : 'with'} owner.lock, retains it`, async t => {
  const dir = await profile(t);
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    import { Store } from ${JSON.stringify(new URL('../src/store.js', import.meta.url).href)};
    class InterruptedStore extends Store {
      async preserveInheritedConnector(record) { await super.preserveInheritedConnector(record); process.exit(0); }
    }
    await new InterruptedStore(process.argv[1]).open();
  `, dir]);
  assert.deepEqual(await readLedger(dir), OLD);
  assert.equal(JSON.parse(await readFile(join(dir, 'owner.lock'), 'utf8')).nonce, 'stale');
  // Model the unlink-to-take gap, and expiry of the recovery directory left by the exited child.
  if (gap) await rm(join(dir, 'owner.lock'));
  const old = new Date(Date.now() - 180_000); await utimes(join(dir, 'reclaim.lock'), old, old);
  const next = await runtime(t, dir); await next.resume();
  assert.equal(next.starts, 0); assert.equal(next.controller.failure.code, 'LOCK');
  assert.deepEqual(await readLedger(dir), OLD);
});

test('a failed ledger save leaves the legacy lease intact for the next owner', async t => {
  const dir = await profile(t), original = await readFile(join(dir, 'owner.lock'), 'utf8');
  class FailedStore extends Store {
    async preserveInheritedConnector() { throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' }); }
  }
  await assert.rejects(new FailedStore(dir).open(), { code: 'ENOSPC' });
  assert.equal(await readFile(join(dir, 'owner.lock'), 'utf8'), original);
  const next = await runtime(t, dir); await next.resume(); assert.equal(next.starts, 0);
});

test('a failed ledger removal refuses a new connector and retains the in-memory record', async t => {
  const dir = await profile(t), f = await runtime(t, dir, 'gone');
  await rename(ledger(dir), join(dir, 'saved-ledger')); await mkdir(ledger(dir));
  try {
    await f.resume(); assert.equal(f.starts, 0); assert.deepEqual(f.store.inheritedConnector, OLD);
    assert.equal(f.controller.retry, null);
  } finally {
    await rm(ledger(dir), { recursive: true }); await rename(join(dir, 'saved-ledger'), ledger(dir));
  }
  await f.controller.dispose();
  const next = await runtime(t, dir); await next.resume(); assert.equal(next.starts, 0);
});

test('corrupt or conflicting durable records fail closed without changing the lease or ledger', async t => {
  for (const bytes of ['{partial', '{}', JSON.stringify({ pid: 43, start: 999 })]) {
    const dir = await profile(t), original = await readFile(join(dir, 'owner.lock'), 'utf8');
    await writeFile(ledger(dir), bytes);
    await assert.rejects(new Store(dir).open(), { code: 'LOCK' });
    assert.equal(await readFile(join(dir, 'owner.lock'), 'utf8'), original);
    assert.equal(await readFile(ledger(dir), 'utf8'), bytes);
  }
});

test('ownership loss refuses clearing the durable record', async t => {
  const dir = await profile(t), f = await runtime(t, dir);
  const replacement = JSON.stringify({ pid: 123, nonce: 'replacement', heartbeatMs: 1 });
  await writeFile(join(dir, 'owner.lock'), replacement);
  await assert.rejects(f.store.clearInheritedConnector(), { code: 'LOCK' });
  assert.deepEqual(await readLedger(dir), OLD);
  await f.controller.dispose();
  assert.equal(await readFile(join(dir, 'owner.lock'), 'utf8'), replacement);
});

test('a fresh acquisition reads the durable record while holding the lease', async t => {
  const dir = await profile(t);
  await writeFile(ledger(dir), JSON.stringify(OLD)); await rm(join(dir, 'owner.lock'));
  class CheckedStore extends Store {
    async readInheritedConnector() {
      // Reading before wx allows another reclaimer to preserve a record between our read and acquisition.
      await this.assertOwnership(); return super.readInheritedConnector();
    }
  }
  const store = await new CheckedStore(dir).open(); t.after(() => store.close());
  assert.deepEqual(store.inheritedConnector, OLD);
});

test('an unreadable ledger on fresh acquisition releases the new lease and preserves the ledger', async t => {
  const dir = await profile(t); await rm(join(dir, 'owner.lock')); await writeFile(ledger(dir), '{partial');
  await assert.rejects(new Store(dir).open(), { code: 'LOCK' });
  await assert.rejects(readFile(join(dir, 'owner.lock')), { code: 'ENOENT' });
  assert.equal(await readFile(ledger(dir), 'utf8'), '{partial');
  await writeFile(ledger(dir), JSON.stringify(OLD));
  const next = await runtime(t, dir); await next.resume(); assert.equal(next.starts, 0);
});
