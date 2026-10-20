import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Store } from './store.js';
import { DshAdapter } from './dsh.js';
import { Controller, UnavailableController, issueOf } from './controller.js';
import { CfError, safeError } from './common.js';
import { rpcRoute } from './rpc.js';

export const name = 'dsh-cf';
// Keep the controller outside the Connection fiber: a supported config edit reloads Connection.
export const inject = ['profileContext'];
// Errors that leave the profile unusable but must not stop DSH from loading the plugin. The settings channel then explains them.
const UNAVAILABLE = new Set(['LOCK', 'STATE_CORRUPT', 'STATE_PATH']);
const RECLAIM_CAP_MS = 60_000;
const DEFAULT_HEARTBEAT_MS = 5_000;

/**
 * Delay before the next `Store.open()` while another lease is held.
 * The first wait is about two heartbeats; each later wait doubles, and none exceeds one minute.
 */
export function reclaimDelayMs(heartbeatMs, attempt = 0) {
  const heartbeat = Number.isFinite(heartbeatMs) && heartbeatMs > 0 ? Math.min(heartbeatMs, RECLAIM_CAP_MS) : DEFAULT_HEARTBEAT_MS;
  const base = Math.min(RECLAIM_CAP_MS, Math.max(1, Math.ceil(heartbeat * 2)));
  const step = Math.min(Math.max(0, attempt | 0), 16);
  return Math.min(RECLAIM_CAP_MS, base * 2 ** step);
}
async function leaseHeartbeatMs(directory, fallback) {
  try {
    const previous = JSON.parse(await readFile(join(directory, 'owner.lock'), 'utf8'));
    if (Number.isFinite(previous.heartbeatMs) && previous.heartbeatMs > 0) return Math.min(previous.heartbeatMs, RECLAIM_CAP_MS);
  } catch { /* the next open() reports a missing or unreadable lock itself */ }
  return fallback;
}
export async function apply(ctx, config = {}) {
  const directory = config.stateDirectory || join(ctx.profileContext.dir, '.dsh-cf');
  const storeOptions = Number.isFinite(config.heartbeatMs) && config.heartbeatMs > 0 ? { heartbeatMs: config.heartbeatMs } : {};
  const fallbackHeartbeat = storeOptions.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  let controller;
  let disposed = false;
  let restored = false;
  let timer = null;
  let pending = null;
  let attempt = 0;
  const stopTimer = () => { clearTimeout(timer); timer = null; };
  const schedule = delay => {
    if (disposed) return;
    stopTimer();
    timer = setTimeout(() => { timer = null; if (!disposed && !pending) void tryOpen({ wait: true }); }, delay);
    timer.unref?.();
  };
  // One open at a time. A failed Store is closed here; dispose waits for this attempt and then drops the timer.
  const tryOpen = async ({ wait }) => {
    if (disposed || pending) return;
    const store = new Store(directory, storeOptions);
    let installed = false;
    const job = (async () => {
      try {
        await store.open({ wait });
        if (disposed) return;
        const previous = controller;
        controller = new Controller({ store, adapter: new DshAdapter(ctx, config), config });
        installed = true;
        attempt = 0;
        let released = true;
        try { await controller.releaseInheritedConnector(); }
        catch (error) {
          released = false;
          if (error?.code === 'LOCK') controller.failure = issueOf(error);
          else {
            const wrapped = error?.code === 'CONNECTOR_EXIT' ? error : new CfError('CONNECTOR_EXIT', 'The previous cloudflared is still running, so this DSH did not start another.');
            controller.failure = issueOf(wrapped);
            controller.scheduleRetry?.(wrapped);
          }
        }
        // The first Connection injection already consumed its one boot call on the placeholder.
        if (restored && released) controller.bootResume();
        await previous?.dispose?.();
      } catch (error) {
        if (disposed) return;
        if (error?.code === 'LOCK') {
          if (!(controller instanceof UnavailableController) || controller.failure?.code !== 'LOCK') controller = new UnavailableController(error);
          const heartbeat = await leaseHeartbeatMs(directory, fallbackHeartbeat);
          // The first retry observes immediately, in the background. Later retries back off.
          schedule(attempt === 0 ? 0 : reclaimDelayMs(heartbeat, attempt - 1));
          attempt += 1;
          return;
        }
        if (UNAVAILABLE.has(error?.code)) { controller = new UnavailableController(error); return; }
        // The first unexpected failure still stops activation. A later attempt keeps the settings channel up.
        if (!controller) throw error;
      } finally {
        if (!installed) await store.close().catch(() => {});
      }
    })();
    pending = job;
    try { await job; }
    finally { if (pending === job) pending = null; }
  };
  // An existing lease must not delay DSH's web server. Observation and reclaim run in the background.
  await tryOpen({ wait: false });
  if (!controller) throw new Error('dsh-cf did not open a controller');
  ctx.effect(() => () => {
    disposed = true;
    stopTimer();
    const job = pending;
    return Promise.resolve(job).then(() => controller?.dispose?.());
  }, 'dsh-cf: owned runtime');
  ctx.inject(['connection', 'webServer'], child => {
    // Re-registered for each Connection generation; see rpc.js for why rpc.handle() is not used.
    const route = rpcRoute(child.connection, async (endpoint, payload, context) => {
      try { return { ok: true, value: await controller.handle(endpoint, payload, context) }; }
      catch (error) { return { ok: false, error: { ...safeError(error), details: {} } }; }
    });
    child.effect(() => child.webServer.register(route), 'dsh-cf: settings channel');
    if (!restored) { restored = true; controller.bootResume(); }
  });
}
