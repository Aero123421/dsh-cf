import { open, readFile, mkdir, rename, unlink, lstat, chmod, rmdir, realpath, stat } from 'node:fs/promises';
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
export const fingerprint = () => digest(`${process.platform}\0${machineName()}\0${homedir()}`);
// Canonical state directories opened by this process, shared across hot-reloaded copies of the module.
const OPEN = globalThis[Symbol.for('dsh-cf.open-stores')] ??= new Set();
const MAX_ACCEPTED_HOSTS = 8;
const lockMtime = async path => { try { return (await stat(path)).mtimeMs; } catch { return null; } };
export class Store {
  /**
   * @param directory - state directory.
   * @param options.heartbeatMs - how often the owner refreshes owner.lock's mtime (its lease heartbeat).
   */
  constructor(directory, { heartbeatMs = 5_000 } = {}) {
    this.dir = resolve(directory); this.queue = Promise.resolve(); this.lock = null; this.registered = false;
    this.heartbeatMs = heartbeatMs; this.heartbeat = null; this.heartbeatWork = null; this.ownershipLost = false;
  }
  async open() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const info = await lstat(this.dir);
    demand(info.isDirectory() && !info.isSymbolicLink(), 'STATE_PATH', 'The state directory must be a real private directory.');
    this.dir = await realpath(this.dir);
    await chmod(this.dir, 0o700);
    demand(!OPEN.has(this.dir), 'LOCK', 'This profile state is already open in this DSH process.');
    OPEN.add(this.dir); this.registered = true;
    try { await this.acquire(); }
    catch (e) { OPEN.delete(this.dir); this.registered = false; throw e; }
    try {
      try { this.state = JSON.parse(await readFile(join(this.dir, 'state.json'), 'utf8')); }
      catch (e) {
        if (e.code !== 'ENOENT') throw new CfError('STATE_CORRUPT', 'State could not be read. It was not reset automatically.');
        this.state = { version: 1, instanceId: randomUUID(), machine: fingerprint(), autoConnect: false, gatePort: 0, setup: null, owned: {}, pending: null };
      }
      const s = this.state;
      demand(s.version === 1 && /^[a-f0-9-]{36}$/.test(s.instanceId) && s.owned && typeof s.owned === 'object' && typeof s.machine === 'string'
        && (s.acceptedMachines === undefined || (Array.isArray(s.acceptedMachines) && s.acceptedMachines.every(x => typeof x === 'string'))), 'STATE_CORRUPT', 'Unrecognized state format. No automatic migration was attempted.');
      if (!this.acceptedHosts().includes(fingerprint())) {
        // Hostnames drift (macOS network changes, re-created containers), but a copied profile must never
        // silently run a second connector for the same Tunnel. Load, keep publication off, and require the
        // local operator to confirm this host before connecting. Removal stays available.
        s.hostReview ??= { at: new Date().toISOString() };
        s.autoConnect = false;
      }
      await this.save(); return this;
    } catch (e) { await this.close(); throw e; }
  }
  /**
   * owner.lock is a lease: the owner refreshes its mtime every heartbeat. PID presence or absence proves
   * nothing across PID namespaces, so every existing lock is observed for longer than one heartbeat.
   */
  async acquire() {
    const path = join(this.dir, 'owner.lock');
    const take = async () => {
      const lock = await open(path, 'wx', 0o600);
      this.lock = nonce(); await lock.writeFile(JSON.stringify({ pid: process.pid, nonce: this.lock, heartbeatMs: this.heartbeatMs })); await lock.close();
      this.heartbeat = setInterval(() => {
        if (!this.heartbeatWork) this.heartbeatWork = this.refreshLease().finally(() => { this.heartbeatWork = null; });
      }, this.heartbeatMs);
      this.heartbeat.unref?.();
    };
    try { await take(); return; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    // Serialize stale-lock reclamation too, so one reclaimer cannot unlink another's new lock.
    const reclaim = join(this.dir, 'reclaim.lock');
    try { await mkdir(reclaim, { mode: 0o700 }); }
    catch { throw new CfError('LOCK', 'Profile ownership is being recovered. Retry, or remove reclaim.lock in the state directory while DSH is stopped.'); }
    try {
      let previous; try { previous = JSON.parse(await readFile(path, 'utf8')); } catch { throw new CfError('LOCK', 'An unreadable lock exists. Inspect owner.lock locally before removing it.'); }
      demand(Number.isSafeInteger(previous.pid) && previous.pid > 0, 'LOCK', 'Invalid owner.lock; inspect it locally.');
      const interval = Number.isFinite(previous.heartbeatMs) && previous.heartbeatMs > 0 ? Math.min(previous.heartbeatMs, 60_000) : this.heartbeatMs;
      const before = await lockMtime(path);
      await pause(Math.ceil(interval * 1.6));
      demand(before !== null && await lockMtime(path) === before, 'LOCK', `Another DSH (PID ${previous.pid}) is actively using this profile. Use a separate profile for each DSH, or stop the other one.`);
      const current = JSON.parse(await readFile(path, 'utf8'));
      demand(current.nonce === previous.nonce, 'LOCK', 'Profile ownership changed. Retry.');
      await unlink(path); await take();
    } finally { await rmdir(reclaim); }
  }
  async assertOwnership() {
    let owner;
    try { owner = JSON.parse(await readFile(join(this.dir, 'owner.lock'), 'utf8')); } catch {}
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
  async refreshLease() {
    let handle;
    try {
      handle = await open(join(this.dir, 'owner.lock'), 'r+');
      const owner = JSON.parse(await handle.readFile('utf8'));
      demand(this.lock && owner.nonce === this.lock, 'LOCK', 'Profile ownership changed.');
      // Refresh the checked inode, not a pathname that may now belong to a new owner.
      const now = new Date(); await handle.utimes(now, now);
    } catch { this.loseOwnership(); }
    finally { await handle?.close().catch(() => {}); }
  }
  acceptedHosts() { return [...new Set([this.state.machine, ...(this.state.acceptedMachines ?? [])])]; }
  /** Explicit local confirmation that this host is the only DSH using this profile's Tunnel. */
  async confirmHost() {
    const current = fingerprint();
    this.state.acceptedMachines = [...this.acceptedHosts().filter(x => x !== current), current].slice(-MAX_ACCEPTED_HOSTS);
    this.state.machine = current; this.state.hostReview = null;
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
