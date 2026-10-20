import { spawn, fork } from 'node:child_process';
import { access, chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute, delimiter, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CfError, demand, boundedJson, timeout, pause } from './common.js';

export const CLOUDFLARED_VERSION = '2026.10.0';
const PLATFORMS = {
  'darwin:arm64': 'cloudflared-darwin-arm64.tgz', 'darwin:x64': 'cloudflared-darwin-amd64.tgz',
  'linux:x64': 'cloudflared-linux-amd64', 'linux:arm64': 'cloudflared-linux-arm64',
  'linux:arm': 'cloudflared-linux-arm', 'linux:ia32': 'cloudflared-linux-386',
  'win32:x64': 'cloudflared-windows-amd64.exe', 'win32:ia32': 'cloudflared-windows-386.exe',
};
export function childEnv(env = process.env) {
  const out = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LOCALAPPDATA', 'ProgramFiles', 'PROGRAMDATA']) if (env[key]) out[key] = env[key];
  return out;
}
export async function run(binary, args, { signal, ms = 10_000, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true, env: { ...childEnv(), ...env }, stdio: ['ignore', 'pipe', 'pipe'], signal: timeout(signal, ms), killSignal: 'SIGKILL' });
    let output = '';
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-16_384); });
    child.stderr.on('data', () => {});
    child.once('error', () => reject(new CfError('BINARY_EXEC', 'The selected executable could not be run.')));
    child.once('exit', code => code === 0 ? resolve(output) : reject(new CfError('BINARY_EXEC', 'The selected executable returned an error.')));
  });
}
// `tunnel run --token-file` arrived in 2025.4.0, JSON log output (`--output json`) in 2025.6.1.
export const MINIMUM_VERSION = '2025.6.1';
export function supportedVersion(text) {
  const m = /cloudflared version (\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!m) return false;
  const have = m.slice(1, 4).map(Number), need = MINIMUM_VERSION.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (have[i] !== need[i]) return have[i] > need[i];
  return true;
}
/** Exact connector argv. Flags are verified against the pinned cloudflared release. */
export function connectorArgs(configFile, tokenFile) {
  return ['--no-autoupdate', 'tunnel', '--config', configFile, '--metrics', '127.0.0.1:0', '--output', 'json', 'run', '--token-file', tokenFile];
}
function allowedAutoPath(path) {
  const full = resolve(path);
  // Never automatically execute a PATH entry supplied by a project checkout.
  if (full === process.cwd() || full.startsWith(process.cwd() + sep)) return false;
  const roots = process.platform === 'win32'
    ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet')].filter(Boolean)
    : ['/usr/bin', '/usr/local/bin', '/usr/local/Cellar/cloudflared', '/opt/homebrew', '/home/linuxbrew/.linuxbrew'];
  return roots.some(root => full === root || full.startsWith(root + sep));
}
async function probe(path, signal, explicit = false) {
  demand(isAbsolute(path), 'BINARY_PATH', 'Use an absolute executable path.');
  const resolved = await realpath(path); const stat = await lstat(resolved);
  demand(stat.isFile() && (process.platform === 'win32' || (stat.mode & 0o022) === 0), 'BINARY_PERMISSIONS', 'Executable must not be group/world writable.');
  if (!explicit) demand(allowedAutoPath(resolved), 'BINARY_PATH', 'Executable is outside trusted installation directories. Select it explicitly.');
  const text = await run(resolved, ['--version'], { signal });
  demand(supportedVersion(text), 'BINARY_OLD', `cloudflared ${MINIMUM_VERSION} or later is required. The existing installation was not modified.`);
  return { path: resolved, version: text.trim(), source: explicit ? 'selected' : 'installed' };
}
export async function ensureBinary({ dir, selected = '', allowDownload = false, signal, onProgress = () => {}, fetchImpl = fetch }) {
  if (selected) return probe(selected, signal, true);
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const paths = new Set((process.env.PATH || '').split(delimiter).filter(p => p && isAbsolute(p) && allowedAutoPath(p)).map(p => join(p, exe)));
  for (const p of process.platform === 'win32' ? [process.env.ProgramFiles && join(process.env.ProgramFiles, 'cloudflared', exe), process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', exe)] : ['/usr/local/bin/cloudflared', '/usr/bin/cloudflared', '/opt/homebrew/bin/cloudflared']) if (p) paths.add(p);
  const warnings = [];
  for (const path of paths) {
    try { return { ...await probe(path, signal), warnings }; }
    catch (e) { if (e instanceof CfError) warnings.push({ path, code: e.code }); }
  }
  const asset = PLATFORMS[`${process.platform}:${process.arch}`];
  demand(asset, 'PLATFORM', 'Automatic download is not available for this OS/CPU. Select a compatible installed cloudflared binary.');
  const cache = join(dir, 'bin', CLOUDFLARED_VERSION); const destination = join(cache, exe);
  try {
    const expected = (await readFile(join(cache, 'binary.sha256'), 'utf8')).trim();
    const info = await lstat(destination);
    demand(info.isFile() && !info.isSymbolicLink(), 'BINARY_INTEGRITY', 'Invalid cached executable.');
    demand(/^[a-f0-9]{64}$/.test(expected) && createHash('sha256').update(await readFile(destination)).digest('hex') === expected, 'BINARY_INTEGRITY', 'Cached executable checksum mismatch. Remove the plugin cache locally and retry.');
    return { ...await probe(destination, signal, true), source: 'managed', warnings };
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  demand(allowDownload, 'DOWNLOAD_APPROVAL', 'No compatible installed cloudflared was found. Allow the private, checksum-verified download to continue.');
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(cache, '.download-'));
  try {
    onProgress({ phase: 'metadata' });
    const metadata = await fetchImpl(`https://api.github.com/repos/cloudflare/cloudflared/releases/tags/${CLOUDFLARED_VERSION}`, { redirect: 'error', signal: timeout(signal), headers: { 'user-agent': 'dsh-cf', accept: 'application/vnd.github+json' } });
    demand(metadata.ok, 'DOWNLOAD_METADATA', 'Could not obtain the pinned official release metadata.');
    const release = await boundedJson(metadata);
    const file = release.assets?.find(x => x.name === asset);
    const expected = file?.digest?.replace(/^sha256:/, '');
    demand(release.tag_name === CLOUDFLARED_VERSION && !release.draft && file && /^[a-f0-9]{64}$/.test(expected), 'DOWNLOAD_INTEGRITY', 'The official release does not provide a SHA-256 digest. Install cloudflared yourself; unverified binaries are not executed.');
    const downloadUrl = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset}`;
    demand(file.browser_download_url === downloadUrl, 'DOWNLOAD_URL', 'Unexpected official asset URL.');
    const response = await fetchImpl(downloadUrl, { signal: timeout(signal, 10 * 60_000), redirect: 'follow' });
    demand(response.ok && response.body && new URL(response.url || downloadUrl).protocol === 'https:', 'DOWNLOAD', 'The official binary download failed.');
    const hash = createHash('sha256'); let received = 0;
    const counter = new Transform({ transform(chunk, _encoding, done) {
      received += chunk.length;
      if (received > 150 * 1024 * 1024) return done(new Error('Download limit'));
      hash.update(chunk); onProgress({ phase: 'downloading', received, total: file.size }); done(null, chunk);
    } });
    // Keep the official asset name: Windows only executes a downloaded PE file with its .exe extension.
    const archive = join(staging, asset);
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(archive, { flags: 'wx', mode: 0o600 }), { signal });
    demand(received === file.size && hash.digest('hex') === expected, 'DOWNLOAD_INTEGRITY', 'Downloaded SHA-256 or size does not match the official release.');
    onProgress({ phase: 'verified' });
    let binary = archive;
    if (asset.endsWith('.tgz')) {
      // Extract only the named regular executable, never arbitrary archive paths.
      const tar = '/usr/bin/tar'; await access(tar);
      const listing = await run(tar, ['-tvzf', archive], { signal });
      const rows = listing.trim().split('\n');
      demand(rows.length === 1 && rows[0].startsWith('-') && /(?:^|\s)(?:\.\/)?cloudflared$/.test(rows[0]), 'ARCHIVE', 'Unexpected archive layout; no files were extracted.');
      await run(tar, ['-xzf', archive, '-C', staging, '--no-same-owner'], { signal });
      binary = join(staging, 'cloudflared');
    }
    const info = await lstat(binary); demand(info.isFile() && !info.isSymbolicLink(), 'ARCHIVE', 'The asset is not a regular executable.');
    await chmod(binary, 0o700);
    const binaryHash = createHash('sha256').update(await readFile(binary)).digest('hex');
    const version = await run(binary, ['--version'], { signal });
    demand(supportedVersion(version) && version.includes(CLOUDFLARED_VERSION), 'BINARY_VERSION', 'The downloaded executable has an unexpected version.');
    await rename(binary, destination);
    await writeFile(join(cache, 'binary.sha256'), binaryHash + '\n', { mode: 0o600 });
    return { path: destination, version: version.trim(), source: 'managed', warnings };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

const START_MAX = 80;
/** Linux starttime, macOS `ps -o lstart=`, or a Windows StartTime. Empty and unreadable values are null. */
export function normalizeStart(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.length >= 1 && text.length <= START_MAX && !/[\u0000\r\n]/.test(text)) return text;
  }
  return null;
}
function linuxStart(text) {
  const end = String(text).lastIndexOf(')');
  if (end < 0) return null;
  const start = Number(String(text).slice(end + 2).split(' ')[19]);
  return Number.isSafeInteger(start) && start >= 0 ? start : null;
}
/**
 * Start time of `pid`, or null when this machine cannot report one.
 * Linux reads `/proc/<pid>/stat` starttime. macOS runs `ps -o lstart= -p <pid>`.
 * Windows reads the process StartTime. `io` is how tests supply a platform without signaling a real process.
 */
export async function readProcessStart(pid, io = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  const platform = io.platform ?? process.platform;
  const read = io.readFile ?? readFile;
  const runCommand = io.run ?? run;
  if (platform === 'linux') return linuxStart(await read(`/proc/${pid}/stat`, 'utf8').catch(() => ''));
  if (platform === 'darwin') {
    try { return normalizeStart(await runCommand('ps', ['-o', 'lstart=', '-p', String(pid)], { env: { LC_ALL: 'C' } })); }
    catch { return null; }
  }
  if (platform === 'win32') {
    const command = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`;
    try {
      const text = normalizeStart(await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]));
      return typeof text === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(text) ? text : null;
    } catch { return null; }
  }
  return null;
}
async function commandLine(pid, io) {
  const platform = io.platform ?? process.platform;
  const read = io.readFile ?? readFile;
  const runCommand = io.run ?? run;
  if (platform === 'linux') return read(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
  if (platform === 'darwin') {
    try { return await runCommand('ps', ['-o', 'args=', '-p', String(pid)], { env: { LC_ALL: 'C' } }); }
    catch { return null; }
  }
  if (platform === 'win32') {
    const command = `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`;
    try { return await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]); }
    catch { return null; }
  }
  return null;
}
async function processExists(pid, io) {
  if (io.exists) return io.exists(pid);
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== 'ESRCH'; }
}
async function processZombie(pid, io) {
  if (io.isZombie) return io.isZombie(pid);
  if ((io.platform ?? process.platform) !== 'linux') return false;
  const read = io.readFile ?? readFile;
  return /^State:\s+Z/m.test(await read(`/proc/${pid}/status`, 'utf8').catch(() => ''));
}
/** A read can fail because the process was reaped after `kill(pid, 0)` succeeded. Check existence again: absence is `gone`, presence stays `unverified`. */
async function unverifiedOrGone(pid, io) {
  return (await processExists(pid, io)) ? 'unverified' : 'gone';
}
/** `gone` when the pid is free, `match` or `zombie` for the recorded cloudflared, `replaced` for another process, `unverified` when the start time cannot be checked. */
async function identifyConnector(record, io) {
  if (!record || !Number.isSafeInteger(record.pid) || record.pid <= 0 || normalizeStart(record.start) == null) return 'unverified';
  if (!(await processExists(record.pid, io))) return 'gone';
  const start = await readProcessStart(record.pid, io);
  if (start == null) return unverifiedOrGone(record.pid, io);
  if (start !== normalizeStart(record.start)) return 'replaced';
  const cmd = await commandLine(record.pid, io);
  if (typeof cmd !== 'string') return unverifiedOrGone(record.pid, io);
  if (cmd.includes('cloudflared')) return 'match';
  if (cmd.trim() === '') return (await processZombie(record.pid, io)) ? 'zombie' : unverifiedOrGone(record.pid, io);
  return 'replaced';
}
/**
 * Stop the cloudflared recorded in owner.lock.
 * `stopped` — that process is gone. `replaced` — the PID belongs to something else and was not signaled.
 * `unverified` — the start time could not be checked, and nothing was signaled.
 * `unverified-after-signal` — a stop signal was sent, then the process still existed but could not be checked.
 * `stuck` — the process was confirmed and is still present about two seconds after SIGKILL.
 * A caller must not start another cloudflared after `unverified`, `unverified-after-signal`, or `stuck`.
 */
export async function stopRecordedConnector(record, io = {}) {
  if (!record) return 'stopped';
  const signal = io.signal;
  const wait = io.pause ?? pause;
  const now = io.now ?? Date.now;
  const termMs = io.termMs ?? 5_000;
  const killMs = io.killMs ?? 2_000;
  let signaled = false;
  const send = name => {
    const signalProcess = io.signalProcess ?? ((pid, sig) => process.kill(pid, sig));
    try { signalProcess(record.pid, name); signaled = true; return 'sent'; }
    catch (error) { return error?.code === 'ESRCH' ? 'missing' : 'denied'; }
  };
  const classify = kind => (kind === 'unverified' && signaled ? 'unverified-after-signal' : kind);
  const finish = async sig => {
    const kind = classify(await identifyConnector(record, io));
    if (kind === 'gone') return 'stopped';
    if (kind === 'replaced' || kind === 'unverified' || kind === 'unverified-after-signal') return kind;
    if (kind === 'zombie' && sig === 'SIGTERM') return 'pending';
    const sent = send(sig);
    if (sent === 'missing') return (await processExists(record.pid, io)) ? 'stuck' : 'stopped';
    if (sent === 'denied') return 'stuck';
    const deadline = now() + (sig === 'SIGKILL' ? killMs : termMs);
    while (now() < deadline) {
      const next = classify(await identifyConnector(record, io));
      if (next === 'gone') return 'stopped';
      if (next === 'replaced' || next === 'unverified' || next === 'unverified-after-signal') return next;
      if (next === 'zombie' && sig === 'SIGTERM') return 'pending';
      await wait(100, signal);
    }
    const last = classify(await identifyConnector(record, io));
    if (last === 'gone') return 'stopped';
    if (last === 'replaced' || last === 'unverified' || last === 'unverified-after-signal') return last;
    return 'pending';
  };
  const first = await identifyConnector(record, io);
  if (first === 'gone') return 'stopped';
  if (first === 'replaced') return 'replaced';
  if (first === 'unverified') return 'unverified';
  if (first === 'match') {
    const termed = await finish('SIGTERM');
    if (termed !== 'pending') return termed;
  }
  const killed = await finish('SIGKILL');
  return killed === 'pending' ? 'stuck' : killed;
}
/** A guardian kills only its own connector on parent IPC loss, including a crashed DSH host. */
export class Connector {
  constructor(onStatus = () => {}) { this.onStatus = onStatus; this.process = null; this.stopping = false; this.failed = false; this.cloudflaredPid = null; this.reportsPid = true; }
  async start(binary, tokenFile) {
    demand(!this.process, 'CONNECTOR_RUNNING', 'A connector is already running.');
    this.stopping = false; this.failed = false; this.cloudflaredPid = null;
    const child = fork(fileURLToPath(new URL('./guardian.js', import.meta.url)), [], { env: { ...childEnv(), ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    this.process = child;
    const report = status => {
      if (this.process !== child) return;
      if (status === 'error' || (status === 'stopped' && !this.stopping)) this.failed = true;
      this.onStatus(this.failed ? 'error' : status);
    };
    let notePid = () => {};
    const reported = new Promise(resolve => {
      const timer = setTimeout(resolve, 2_000);
      timer.unref?.();
      notePid = () => { clearTimeout(timer); resolve(); };
      child.once('exit', notePid);
    });
    child.on('message', value => {
      if (value?.type === 'connector' && Number.isSafeInteger(value.pid) && value.pid > 0) { this.cloudflaredPid = value.pid; notePid(); }
      if (value?.type === 'status' && ['starting', 'connected', 'disconnected', 'error', 'stopped'].includes(value.status)) report(value.status);
    });
    child.on('error', () => report('error'));
    child.once('exit', () => { if (this.process === child) { report(this.stopping ? 'stopped' : 'error'); this.process = null; } });
    child.send({ type: 'start', binary, tokenFile });
    await reported;
  }
  async stop() {
    const child = this.process; if (!child) return;
    this.stopping = true;
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 12_000); timer.unref();
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      if (child.connected) child.send({ type: 'stop' }); else child.kill('SIGTERM');
    });
    if (this.process === child) this.process = null;
  }
}
