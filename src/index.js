import { join } from 'node:path';
import { Store } from './store.js';
import { DshAdapter } from './dsh.js';
import { Controller } from './controller.js';
import { safeError } from './common.js';
import { Updates, VERSION, runtimeVersion } from './updates.js';
import { rpcRoute } from './rpc.js';

export const name = 'dsh-cf';
// Keep the controller outside the Connection fiber: a supported config edit reloads Connection.
export const inject = ['profileContext'];
export async function apply(ctx, config = {}) {
  const directory = config.stateDirectory || join(ctx.profileContext.dir, '.dsh-cf');
  const store = await new Store(directory).open();
  let controller;
  try { controller = new Controller({ store, adapter: new DshAdapter(ctx, config), config }); }
  catch (error) { await store.close(); throw error; }
  const updates = new Updates({ manager: () => ctx.get('pluginManager'), profileDir: ctx.profileContext.dir, runtime: runtimeVersion(ctx.profileContext), busy: () => controller.snapshot().busy });
  ctx.effect(() => () => controller.dispose(), 'dsh-cf: owned runtime');
  ctx.effect(() => () => updates.dispose(), 'dsh-cf: plugin updater');
  let restored = false;
  ctx.inject(['connection', 'webServer'], child => {
    // Re-registered for each Connection generation; see rpc.js for why rpc.handle() is not used.
    const route = rpcRoute(child.connection, async (endpoint, payload) => {
      try {
        let value;
        if (endpoint === 'update-status') value = await updates.status(payload?.operationId);
        else if (endpoint === 'update-check') value = await updates.check(payload?.channel);
        else if (endpoint === 'update-install') value = await updates.install(payload?.candidateId, payload?.operationId, payload?.channel);
        else { value = await controller.handle(endpoint, payload); if (endpoint === 'status') value = { ...value, version: VERSION, update: updates.view }; }
        return { ok: true, value };
      }
      catch (error) { return { ok: false, error: { ...safeError(error), details: {} } }; }
    });
    child.effect(() => child.webServer.register(route), 'dsh-cf: settings channel');
    if (!restored) {
      restored = true;
      if (store.state.autoConnect) controller.launch(signal => controller.start({}, signal, true));
    }
  });
}
