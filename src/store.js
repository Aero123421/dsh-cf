import { open, readFile, mkdir, rename, unlink, lstat, chmod, rmdir, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { hostname as machineName, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { CfError, demand, digest, nonce, pause } from './common.js';

const ACCOUNT_ID = /^[a-f0-9]{32}$/;
const TUNNEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_BYTES = 32;
function decodeBase64(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) return null;
  const padded = normalized.length % 4 === 0 ? normalized : normalized + '='.repeat(4 - (normalized.length % 4));
  const bytes = Buffer.from(padded, 'base64');
  if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== padded.replace(/=+$/, '')) return null;
  return bytes;
}
/** Cloudflare connector token: base64 JSON `{a, t, s}` for one account, one tunnel, and a secret of at least 32 bytes. The original string is what gets stored. */
export function parseConnectorToken(token) {
  if (typeof token !== 'string' || /[\s\r\n]/.test(token)) return null;
  const bytes = decodeBase64(token);
  if (!bytes) return null;
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some(key => key !== 'a' && key !== 't' && key !== 's')) return null;
  if (typeof value.a !== 'string' || !ACCOUNT_ID.test(value.a)) return null;
  if (typeof value.t !== 'string' || !TUNNEL_ID.test(value.t)) return null;
  const secret = typeof value.s === 'string' ? decodeBase64(value.s) : null;
  if (!secret || secret.length < SECRET_BYTES) return null;
  return { accountId: value.a, tunnelId: value.t.toLowerCase() };
}
export async function privateWrite(path, bytes, beforeCommit = () => {}) {
  const temp = `${path}.${nonce()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  catch (e) { await handle.close(); await unlink(temp).catch(() => {}); throw e; }
  await handle.close();
  try { await beforeCommit(); await rename(temp, path); await chmod(path, 0o600); }
  finally { await unlink(temp).catch(() => {}); }
}
/** Hostname-based identity written by every earlier version. It changes whenever the OS hostname does. */
export const fingerprint = () => digest(`${process.platform}\0${machineName()}\0${homedir()}`);
const run = (file, args) => new Promise(resolve => {
  try { execFile(file, args, { timeout: 3000, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout) => resolve(error ? '' : String(stdout))); }
  catch { resolve(''); }
});
/** The OS's own stable machine identifier, or null where none can be read cheaply. */
export async function readMachineId() {
  if (process.platform === 'linux') {
    for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      const value = (await readFile(path, 'utf8').catch(() => '')).trim().toLowerCase();
      if (/^[a-f0-9]{32}$/.test(value)) return value;
    }
    return null;
  }
  if (process.platform === 'darwin') return /"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{36})"/.exec(await run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']))?.[1]?.toLowerCase() ?? null;
  if (process.platform === 'win32') return /MachineGuid\s+REG_SZ\s+([0-9A-Fa-f-]{36})/.exec(await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']))?.[1]?.toLowerCase() ?? null;
  return null;
}
/**
 * Version 2 identity: derived from the machine id so renaming the host (macOS does this per network) is not a new host.
 * Containers built from one Linux image often share /etc/machine-id, so on Linux the hostname still separates them.
 */
export const fingerprintV2 = async (readId = readMachineId, { platform = process.platform, host = machineName() } = {}) => {
  const id = await readId().catch(() => null);
  return id ? digest(`dsh-cf.machine.v2\0${platform}\0${id}${platform === 'linux' ? `\0${host}` : ''}`) : null;
};
// Canonical state directories opened by this process, shared across hot-reloaded copies of the module.
const OPEN = globalThis[Symbol.for('dsh-cf.open-stores')] ??= new Set();
const MAX_ACCEPTED_HOSTS = 8;
const lockMtime = async path => { try { return (await stat(path)).mtimeMs; } catch { return null; } };
/** Identity of a cloudflared this profile started. `start` is the OS process start counter, so a reused PID does not match. */
export function connectorRecord(value) {
  if (!value || typeof value !== 'object') return null;
  if (!Number.isSafeInteger(value.pid) || value.pid <= 0) return null;
  if (!Number.isSafeInteger(value.start) || value.start < 0) return null;
  return { pid: value.pid, start: value.start };
}
export class Store {
  /**
   * @param directory - state directory.
   * @param options.heartbeatMs - how often the owner refreshes owner.lock's mtime (its lease heartbeat).
   */
  constructor(directory, { heartbeatMs = 5_000, machineId = readMachineId, staleReclaimMs = 120_000, leaseFailureLimit = 3 } = {}) {
    this.dir = resolve(directory); this.queue = Promise.resolve(); this.lock = null; this.registered = false;
    this.heartbeatMs = heartbeatMs; this.heartbeat = null; this.heartbeatWork = null; this.ownershipLost = false;
    this.machineId = machineId; this.staleReclaimMs = staleReclaimMs; this.leaseFailureLimit = leaseFailureLimit; this.leaseFailures = 0;
  }
  /**
   * @param wait - when false, an existing owner.lock fails immediately. Plugin startup uses that so DSH's web
   * server is not held for the stale-lock observation; a later open() observes and reclaims in the background.
   */
  async open({ wait = true } = {}) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const info = await lstat(this.dir);
    demand(info.isDirectory() && !info.isSymbolicLink(), 'STATE_PATH', 'The state directory must be a real private directory.');
    this.dir = await realpath(this.dir);
    await chmod(this.dir, 0o700);
    demand(!OPEN.has(this.dir), 'LOCK', 'This profile state is already open in this DSH process.');
    OPEN.add(this.dir); this.registered = true;
    try { await this.acquire({ wait }); }
    catch (e) { OPEN.delete(this.dir); this.registered = false; throw e; }
    try {
      try { this.state = JSON.parse(await readFile(join(this.dir, 'state.json'), 'utf8')); }
      catch (e) {
        if (e.code !== 'ENOENT') throw new CfError('STATE_CORRUPT', 'State could not be read. It was not reset automatically.');
        this.state = { version: 1, instanceId: randomUUID(), machine: fingerprint(), autoConnect: false, gatePort: 0, setup: null, owned: {}, pending: null };
      }
      const s = this.state;
      demand(s.version === 1 && /^[a-f0-9-]{36}$/.test(s.instanceId) && s.owned && typeof s.owned === 'object' && typeof s.machine === 'string'
        && (s.acceptedMachines === undefined || (Array.isArray(s.acceptedMachines) && s.acceptedMachines.every(x => typeof x === 'string')))
        && (s.machineV2 === undefined || (typeof s.machineV2 === 'string' && /^[a-f0-9]{64}$/.test(s.machineV2)))
        && (s.paused === undefined || typeof s.paused === 'boolean')
        && (s.labels === undefined || (s.labels && typeof s.labels === 'object' && !Array.isArray(s.labels) && ['account', 'idp'].every(k => s.labels[k] === null || (typeof s.labels[k] === 'string' && s.labels[k].length <= 200))))
        && (s.trustedHostAdded === undefined || (s.trustedHostAdded && typeof s.trustedHostAdded.hostname === 'string' && ['array', 'expr'].includes(s.trustedHostAdded.form) && typeof s.trustedHostAdded.created === 'boolean'))
        && (s.setup?.requireWebAuthn === undefined || typeof s.setup.requireWebAuthn === 'boolean'), 'STATE_CORRUPT', 'Unrecognized state format. No automatic migration was attempted.');
      await this.checkHost(s);
      await this.save(); return this;
    } catch (e) { await this.close(); throw e; }
  }
  /**
   * owner.lock is a lease: the owner refreshes its mtime every heartbeat. PID presence or absence proves
   * nothing across PID namespaces, so every existing lock is observed for longer than one heartbeat.
   */
  async acquire({ wait = true } = {}) {
    const path = join(this.dir, 'owner.lock');
    const take = async () => {
      const lock = await open(path, 'wx', 0o600);
      this.lock = nonce();
      this.inheritedConnector = null;
      await lock.writeFile(JSON.stringify({ pid: process.pid, nonce: this.lock, heartbeatMs: this.heartbeatMs }));
      await lock.close();
      this.heartbeat = setInterval(() => {
        if (!this.heartbeatWork) this.heartbeatWork = this.refreshLease().finally(() => { this.heartbeatWork = null; });
      }, this.heartbeatMs);
      this.heartbeat.unref?.();
    };
    try { await take(); return; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Startup must not sit inside the observation. The caller retries with wait:true in the background.
      if (!wait) throw new CfError('LOCK', 'Another DSH holds this profile. Startup continues and this plugin retries the lease in the background.');
    }
    // Serialize stale-lock reclamation too, so one reclaimer cannot unlink another's new lock.
    const reclaim = join(this.dir, 'reclaim.lock');
    try { await mkdir(reclaim, { mode: 0o700 }); }
    catch {
      // A crash during recovery leaves this directory behind. Recovery takes seconds, so an old one is stale.
      const age = Date.now() - (await lockMtime(reclaim) ?? Date.now());
      if (age < this.staleReclaimMs) throw new CfError('LOCK', 'Profile ownership is being recovered. Retry in a minute.');
      await rmdir(reclaim).catch(() => {});
      try { await mkdir(reclaim, { mode: 0o700 }); }
      catch { throw new CfError('LOCK', 'Profile ownership is being recovered. Retry in a minute.'); }
    }
    try {
      let previous; try { previous = JSON.parse(await readFile(path, 'utf8')); } catch { throw new CfError('LOCK', 'An unreadable lock exists. Inspect owner.lock locally before removing it.'); }
      demand(Number.isSafeInteger(previous.pid) && previous.pid > 0, 'LOCK', 'Invalid owner.lock; inspect it locally.');
      const interval = Number.isFinite(previous.heartbeatMs) && previous.heartbeatMs > 0 ? Math.min(previous.heartbeatMs, 60_000) : this.heartbeatMs;
      const before = await lockMtime(path);
      await pause(Math.ceil(interval * 1.6));
      demand(before !== null && await lockMtime(path) === before, 'LOCK', `Another DSH (PID ${previous.pid}) is actively using this profile. Use a separate profile for each DSH, or stop the other one.`);
      const current = JSON.parse(await readFile(path, 'utf8'));
      demand(current.nonce === previous.nonce, 'LOCK', 'Profile ownership changed. Retry.');
      const inherited = connectorRecord(current.connector);
      await unlink(path); await take();
      // take() clears inheritedConnector. Put back the cloudflared the previous owner recorded.
      this.inheritedConnector = inherited;
    } finally { await rmdir(reclaim); }
  }
  /** Rewrite owner.lock on the inode we already own. A mismatched nonce loses ownership and writes nothing. */
  async writeLock(mutate) {
    await this.assertOwnership();
    const path = join(this.dir, 'owner.lock');
    const handle = await open(path, 'r+');
    try {
      const owner = JSON.parse(await handle.readFile('utf8'));
      if (!this.lock || owner.nonce !== this.lock) { this.loseOwnership(); throw new CfError('LOCK', 'Profile ownership was lost. No state or token was written.'); }
      const next = JSON.stringify(mutate(owner));
      // readFile() left the offset at the old end. writeFile() ignores position, so write at 0 after truncate.
      await handle.truncate(0);
      await handle.write(next, 0, 'utf8');
      const now = new Date(); await handle.utimes(now, now);
    } finally { await handle?.close().catch(() => {}); }
  }
  /** cloudflared pid and start time, so the next owner can stop that process after a takeover. Not a lock decision. */
  recordConnector(connector) {
    const record = connectorRecord(connector);
    demand(record, 'LOCK', 'The connector identity is incomplete, so it was not recorded.');
    return this.writeLock(owner => ({ ...owner, connector: record }));
  }
  clearConnector() { return this.writeLock(owner => { const next = { ...owner }; delete next.connector; return next; }); }
  async assertOwnership() {
    let owner, unreadable = false;
    try { owner = JSON.parse(await readFile(join(this.dir, 'owner.lock'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') unreadable = true; }
    if (unreadable && this.lock && !this.ownershipLost) throw new CfError('LOCK', 'The profile lock could not be read just now, so nothing was written. Retry.');
    if (!this.lock || this.ownershipLost || owner?.nonce !== this.lock) {
      this.loseOwnership();
      throw new CfError('LOCK', 'Profile ownership was lost. No state or token was written.');
    }
  }
  loseOwnership() {
    if (this.ownershipLost) return;
    this.ownershipLost = true; clearInterval(this.heartbeat); this.heartbeat = null;
    // The host shuts down only this store's gate/connector; never touch the new owner's lock.
    void Promise.resolve().then(() => this.onOwnershipLost?.()).catch(() => {});
  }
  /**
   * Ownership is lost when the lock is readable and carries another nonce, when it is gone, or after several
   * consecutive failures to refresh it. One transient I/O error (a busy disk, a brief sleep) is not a loss.
   */
  async refreshLease() {
    let handle;
    try {
      handle = await open(join(this.dir, 'owner.lock'), 'r+');
      const owner = JSON.parse(await handle.readFile('utf8'));
      if (!this.lock || owner.nonce !== this.lock) return this.loseOwnership();
      // Refresh the checked inode, not a pathname that may now belong to a new owner.
      const now = new Date(); await handle.utimes(now, now);
      this.leaseFailures = 0;
    } catch (error) {
      if (error?.code === 'ENOENT' || ++this.leaseFailures >= this.leaseFailureLimit) this.loseOwnership();
    } finally { await handle?.close().catch(() => {}); }
  }
  /** Host identities the operator accepted: the hostname-based values and the stable machine ids. */
  acceptedHosts() { return [...new Set([this.state.machine, this.state.machineV2, ...(this.state.acceptedMachines ?? [])].filter(Boolean))]; }
  /**
   * A copied profile must never silently run a second connector for the same Tunnel. Load, keep publication off
   * (the auto-connect preference is kept) and require the local operator to confirm. Removal stays available.
   * The stable machine id is authoritative once the profile is bound to one; the hostname-based value only
   * applies to a profile that was never bound (older versions) or on a machine whose id cannot be read.
   */
  async checkHost(s) {
    const stable = await fingerprintV2(this.machineId), accepted = this.acceptedHosts();
    if (stable && accepted.includes(stable)) return;
    if (accepted.includes(fingerprint()) && (!stable || !s.machineV2)) { if (stable) s.machineV2 = stable; return; }
    s.hostReview ??= { at: new Date().toISOString() };
  }
  /** Explicit local confirmation that this host is the only DSH using this profile's Tunnel. */
  async confirmHost() {
    const current = fingerprint(), stable = await fingerprintV2(this.machineId);
    this.state.acceptedMachines = [...this.acceptedHosts().filter(x => x !== current && x !== stable), current, ...(stable ? [stable] : [])].slice(-MAX_ACCEPTED_HOSTS);
    this.state.machine = current; this.state.hostReview = null;
    if (stable) this.state.machineV2 = stable;
    await this.save();
  }
  save() {
    const snapshot = JSON.stringify(this.state, null, 2) + '\n';
    const write = this.queue.then(async () => { await this.assertOwnership(); await privateWrite(join(this.dir, 'state.json'), snapshot, () => this.assertOwnership()); });
    this.queue = write.catch(() => {}); return write;
  }
  async writeToken(token) {
    demand(parseConnectorToken(token), 'TOKEN', 'Cloudflare returned an invalid connector token.');
    await this.assertOwnership();
    await privateWrite(join(this.dir, 'tunnel.token'), token, () => this.assertOwnership());
  }
  async hasToken() { try { return (await lstat(join(this.dir, 'tunnel.token'))).isFile(); } catch { return false; } }
  async clearToken() { await this.assertOwnership(); await unlink(join(this.dir, 'tunnel.token')).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  async close() {
    clearInterval(this.heartbeat); this.heartbeat = null;
    try {
      await this.queue;
      await this.heartbeatWork;
      if (!this.lock) return;
      const path = join(this.dir, 'owner.lock');
      try { const value = JSON.parse(await readFile(path, 'utf8')); if (value.nonce === this.lock) await unlink(path); } catch {}
    } finally {
      this.lock = null;
      if (this.registered) { OPEN.delete(this.dir); this.registered = false; }
    }
  }
}
