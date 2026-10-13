import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, stat, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.js';
import { ensureBinary, childEnv, supportedVersion, Connector, CLOUDFLARED_VERSION } from '../src/connector.js';
async function directory(t) { const dir = await mkdtemp(join(tmpdir(), 'dsh-cf-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
test('state is private, persists without credentials, and active profile locks are exclusive', async t => {
  const dir = await directory(t); const store = await new Store(dir).open(); t.after(() => store.close());
  await assert.rejects(new Store(dir).open(), { code: 'LOCK' });
  store.state.gatePort = 4321; await store.save(); await store.writeToken('connector-private-'.repeat(4));
  if (process.platform !== 'win32') { assert.equal((await stat(join(dir, 'tunnel.token'))).mode & 0o777, 0o600); assert.equal((await stat(dir)).mode & 0o777, 0o700); }
  assert(!(await readFile(join(dir, 'state.json'), 'utf8')).includes('connector-private'));
  const id = store.state.instanceId; await store.close(); const reopened = await new Store(dir).open(); t.after(() => reopened.close());
  assert.equal(reopened.state.instanceId, id); assert.equal(reopened.state.gatePort, 4321);
});
test('a corrupt state is never reset into a fresh public instance', async t => {
  const dir = await directory(t); await writeFile(join(dir, 'state.json'), '{not-json');
  await assert.rejects(new Store(dir).open(), { code: 'STATE_CORRUPT' }); assert.equal(await readFile(join(dir, 'state.json'), 'utf8'), '{not-json');
});
test('copied instance state is refused on a different host fingerprint', async t => {
  const dir = await directory(t); const store = await new Store(dir).open(); store.state.machine = 'another-machine'; await store.save(); await store.close();
  await assert.rejects(new Store(dir).open(), { code: 'COPIED_STATE' });
});
test('a stale lock is reclaimed without stealing a live new lock', async t => {
  const dir = await directory(t); await writeFile(join(dir, 'owner.lock'), JSON.stringify({ pid: 2147483647, nonce: 'old' }));
  const store = await new Store(dir).open(); t.after(() => store.close());
  assert.notEqual(JSON.parse(await readFile(join(dir, 'owner.lock'))).nonce, 'old'); await assert.rejects(new Store(dir).open(), { code: 'LOCK' });
});
test('connector environment excludes API keys, injection flags, and shared tunnel config', () => {
  assert.deepEqual(childEnv({ PATH: '/bin', HOME: '/home/test', OPENAI_API_KEY: 'SECRET', CLOUDFLARE_API_TOKEN: 'SECRET', TUNNEL_TOKEN: 'SECRET', NODE_OPTIONS: '--require bad' }), { PATH: '/bin', HOME: '/home/test' });
  assert(supportedVersion('cloudflared version 2025.4.0')); assert(!supportedVersion('cloudflared version 2025.3.9'));
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
test('guardian starts a real fixture child and stops only that child', unix, async t => {
  const dir = await directory(t), binary = join(dir, 'cloudflared'), pidFile = join(dir, 'pid');
  await writeFile(binary, `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));\nconsole.log(JSON.stringify({message:'Registered tunnel connection'}));\nsetInterval(()=>{},1000);\n`, { mode: 0o700 });
  const statuses = []; const connector = new Connector(s => statuses.push(s)); t.after(() => connector.stop());
  await connector.start(binary, join(dir, 'tunnel.token'));
  for (let i = 0; !statuses.includes('connected') && i < 100; i++) await new Promise(r => setTimeout(r, 20));
  assert(statuses.includes('connected')); const pid = Number(await readFile(pidFile));
  await connector.stop(); assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
