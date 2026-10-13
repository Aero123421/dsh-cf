import { open, readFile, mkdir, rename, unlink, lstat, chmod, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hostname as machineName, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { CfError, demand, digest, nonce } from './common.js';

export async function privateWrite(path, bytes) {
  const temp = `${path}.${nonce()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  catch (e) { await handle.close(); await unlink(temp).catch(() => {}); throw e; }
  await handle.close();
  try { await rename(temp, path); await chmod(path, 0o600); }
  finally { await unlink(temp).catch(() => {}); }
}
const fingerprint = () => digest(`${process.platform}\0${machineName()}\0${homedir()}`);
export class Store {
  constructor(directory) { this.dir = resolve(directory); this.queue = Promise.resolve(); this.lock = null; }
  async open() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const info = await lstat(this.dir);
    demand(info.isDirectory() && !info.isSymbolicLink(), 'STATE_PATH', 'The state directory must be a real private directory.');
    await chmod(this.dir, 0o700);
    const path = join(this.dir, 'owner.lock');
    const take = async () => {
      const lock = await open(path, 'wx', 0o600);
      this.lock = nonce(); await lock.writeFile(JSON.stringify({ pid: process.pid, nonce: this.lock })); await lock.close();
    };
    try { await take(); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Serialize stale-lock reclamation too, so one reclaimer cannot unlink another's new lock.
      const reclaim = join(this.dir, 'reclaim.lock');
      try { await mkdir(reclaim, { mode: 0o700 }); }
      catch { throw new CfError('LOCK', 'Profile ownership is being recovered. Retry or inspect reclaim.lock locally.'); }
      try {
        let previous; try { previous = JSON.parse(await readFile(path, 'utf8')); } catch { throw new CfError('LOCK', 'An unreadable lock exists. Inspect owner.lock locally before removing it.'); }
        demand(Number.isSafeInteger(previous.pid) && previous.pid > 0, 'LOCK', 'Invalid owner.lock; inspect it locally.');
        try { process.kill(previous.pid, 0); throw new CfError('LOCK', 'Another DSH process owns this profile. Use a separate profile for another instance.'); }
        catch (e) { if (e.code !== 'ESRCH') throw e; }
        const current = JSON.parse(await readFile(path, 'utf8'));
        demand(current.nonce === previous.nonce, 'LOCK', 'Profile ownership changed. Retry.');
        await unlink(path); await take();
      } finally { await rmdir(reclaim); }
    }
    try {
      try { this.state = JSON.parse(await readFile(join(this.dir, 'state.json'), 'utf8')); }
      catch (e) {
        if (e.code !== 'ENOENT') throw new CfError('STATE_CORRUPT', 'State could not be read. It was not reset automatically.');
        this.state = { version: 1, instanceId: randomUUID(), machine: fingerprint(), autoConnect: false, gatePort: 0, setup: null, owned: {}, pending: null };
      }
      demand(this.state.version === 1 && /^[a-f0-9-]{36}$/.test(this.state.instanceId) && this.state.owned && typeof this.state.owned === 'object', 'STATE_CORRUPT', 'Unrecognized state format. No automatic migration was attempted.');
      demand(this.state.machine === fingerprint(), 'COPIED_STATE', 'This state belongs to another host. Do not share one tunnel token between different DSHs; set up a new profile.');
      await this.save(); return this;
    } catch (e) { await this.close(); throw e; }
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
    await this.queue;
    if (!this.lock) return;
    const path = join(this.dir, 'owner.lock');
    try { const value = JSON.parse(await readFile(path, 'utf8')); if (value.nonce === this.lock) await unlink(path); } catch {}
    this.lock = null;
  }
}
