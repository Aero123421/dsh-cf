import { open, readFile, mkdir, rename, unlink, lstat, chmod, rmdir, realpath, stat, utimes } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hostname as machineName, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { CfError, demand, digest, nonce, pause } from './common.js';

export async function privateWrite(path, bytes) {
  const temp = `${path}.${nonce()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  catch (e) { await handle.close(); await unlink(temp).catch(() => {}); throw e; }
  await handle.close();
  try { await rename(temp, path); await chmod(path, 0o600); }
  finally { await unlink(temp).catch(() => {}); }
}
export const fingerprint = () => digest(`${process.platform}\0${machineName()}\0${homedir()}`);
// Canonical state directories opened by this process, shared across hot-reloaded copies of the module.
const OPEN = globalThis[Symbol.for('dsh-cf.open-stores')] ??= new Set();
const MAX_ACCEPTED_HOSTS = 8;
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}
const lockMtime = async path => { try { return (await stat(path)).mtimeMs; } catch { return null; } };
export class Store {
  /**
   * @param directory - state directory.
   * @param options.heartbeatMs - how often the owner refreshes owner.lock's mtime (its lease heartbeat).
   */
  constructor(directory, { heartbeatMs = 5_000 } = {}) {
    this.dir = resolve(directory); this.queue = Promise.resolve(); this.lock = null; this.registered = false;
    this.heartbeatMs = heartbeatMs; this.heartbeat = null;
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
   * owner.lock is a lease: the owner refreshes its mtime every heartbeat. A lock is reclaimed only when its
   * PID is dead in this PID namespace, or when its heartbeat stops. PID equality or liveness alone proves
   * nothing across PID namespaces (two containers sharing one volume often both run as PID 1), so a lock
   * that looks alive is observed for longer than one heartbeat before it is treated as abandoned.
   */
  async acquire() {
    const path = join(this.dir, 'owner.lock');
    const take = async () => {
      const lock = await open(path, 'wx', 0o600);
      this.lock = nonce(); await lock.writeFile(JSON.stringify({ pid: process.pid, nonce: this.lock, heartbeatMs: this.heartbeatMs })); await lock.close();
      this.heartbeat = setInterval(() => { const now = new Date(); void utimes(path, now, now).catch(() => {}); }, this.heartbeatMs);
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
      const deadInThisNamespace = previous.pid !== process.pid && !alive(previous.pid);
      if (!deadInThisNamespace) {
        // Live-looking owner (or our own PID from another namespace or an earlier crashed run): watch the lease.
        const interval = Number.isFinite(previous.heartbeatMs) && previous.heartbeatMs > 0 ? Math.min(previous.heartbeatMs, 60_000) : this.heartbeatMs;
        const before = await lockMtime(path);
        if (before !== null && Date.now() - before < interval * 3) {
          await pause(Math.ceil(interval * 1.6));
          const after = await lockMtime(path);
          if (after !== before) throw new CfError('LOCK', `Another DSH (PID ${previous.pid}) is actively using this profile. Use a separate profile for each DSH, or stop the other one.`);
        }
      }
      const current = JSON.parse(await readFile(path, 'utf8'));
      demand(current.nonce === previous.nonce, 'LOCK', 'Profile ownership changed. Retry.');
      await unlink(path); await take();
    } finally { await rmdir(reclaim); }
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
    const write = this.queue.then(() => privateWrite(join(this.dir, 'state.json'), snapshot));
    this.queue = write.catch(() => {}); return write;
  }
  async writeToken(token) {
    demand(typeof token === 'string' && token.length > 20 && !/[\s\r\n]/.test(token), 'TOKEN', 'Cloudflare returned an invalid connector token.');
    await privateWrite(join(this.dir, 'tunnel.token'), token);
  }
  async hasToken() { try { return (await lstat(join(this.dir, 'tunnel.token'))).isFile(); } catch { return false; } }
  async clearToken() { await unlink(join(this.dir, 'tunnel.token')).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  async close() {
    clearInterval(this.heartbeat); this.heartbeat = null;
    try {
      await this.queue;
      if (!this.lock) return;
      const path = join(this.dir, 'owner.lock');
      try { const value = JSON.parse(await readFile(path, 'utf8')); if (value.nonce === this.lock) await unlink(path); } catch {}
    } finally {
      this.lock = null;
      if (this.registered) { OPEN.delete(this.dir); this.registered = false; }
    }
  }
}
