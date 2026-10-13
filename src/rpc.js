/**
 * The settings channel `/dsh-cf`, served with DSH's public RPC wire contract:
 * POST `/dsh-cf/<endpoint>` with `{type: 'client-request', rpcId, method, payload}` answered by
 * `{type: 'server-response', rpcId, result}`, which the browser's `connection.rpc.call('/dsh-cf', …)` speaks.
 *
 * Why not `connection.rpc.handle()`: in DSH 0.2.1-alpha.2 that method registers its route through
 * `owner.webServer`, which cordis resolves inside the Connection plugin's own fiber (it injects only
 * `credentials`), so it throws "cannot get property "webServer" without inject" for every plugin context.
 * The route is therefore registered on the official WebServer route table, and every request is admitted
 * by the official `connection.requestRejection()` Host/Origin/cookie fence, exactly as Connection does.
 */
export const CHANNEL = '/dsh-cf';
const SEGMENT = /^[A-Za-z0-9_$.-]+$/;
const MAX_BODY_BYTES = 64 * 1024;

export function endpointOf(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(`${CHANNEL}/`)) return undefined;
  const endpoint = pathname.slice(CHANNEL.length + 1);
  return endpoint.split('/').every(s => s !== '' && s !== '.' && s !== '..' && SEGMENT.test(s)) ? endpoint : undefined;
}
export function isManagementRequest(req) {
  const address = req.socket?.remoteAddress?.replace(/^::ffff:/, '');
  const loopback = value => value === 'localhost' || value === '::1' || value === '[::1]' || /^127\.(?:[0-9]{1,3}\.){2}[0-9]{1,3}$/.test(value || '') && value.split('.').every(part => Number(part) <= 255);
  if (!loopback(address)) return false;
  for (const name of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip']) if (req.headers[name] !== undefined) return false;
  try {
    if (!loopback(new URL(`http://${req.headers.host}`).hostname)) return false;
    return req.headers.origin === undefined || loopback(new URL(req.headers.origin).hostname);
  } catch { return false; }
}
function text(res, status, body) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}
function respond(res, rpcId, result) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify({ type: 'server-response', rpcId, result }));
}
const badRequest = message => ({ ok: false, error: { code: 'gateway/bad-request', message, details: {} } });
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    const finish = (error, value) => { if (done) return; done = true; error ? reject(error) : resolve(value); };
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { req.pause(); finish(Object.assign(new Error('Body limit'), { code: 'BODY' })); return; }
      chunks.push(chunk);
    });
    req.once('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
    req.once('error', error => finish(error));
    req.once('aborted', () => finish(new Error('aborted')));
  });
}

/**
 * @param connection - DSH Connection service of the current Connection generation.
 * @param handle - `(endpoint, payload) => Promise<{ok: true, value} | {ok: false, error}>`; must not throw.
 * @returns a WebServer prefix route for `webServer.register()`.
 */
export function rpcRoute(connection, handle) {
  return {
    kind: 'prefix',
    path: CHANNEL,
    handler: async (req, res) => {
      const rejection = connection.requestRejection(req);
      if (rejection !== undefined) {
        if (!res.headersSent) { res.writeHead(rejection, { 'cache-control': 'no-store' }); res.end(rejection === 401 ? 'unauthorized' : 'forbidden'); }
        return;
      }
      let url; try { url = new URL(req.url, 'http://local.invalid'); } catch { return text(res, 404, 'not found'); }
      const endpoint = endpointOf(url.pathname);
      if (endpoint?.startsWith('update-') && !isManagementRequest(req)) return text(res, 403, 'management connection required');
      if (req.method !== 'POST' || endpoint === undefined || url.search) return text(res, 404, 'not found');
      if (String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') return text(res, 415, 'content type must be application/json');
      let raw;
      try { raw = await readBody(req, MAX_BODY_BYTES); }
      catch (e) { res.setHeader?.('connection', 'close'); return text(res, e.code === 'BODY' ? 413 : 400, e.code === 'BODY' ? 'request body too large' : 'request body was not received'); }
      let body; try { body = JSON.parse(raw); } catch { return text(res, 400, 'body is not JSON'); }
      const valid = body && typeof body === 'object' && !Array.isArray(body) && body.type === 'client-request' && typeof body.rpcId === 'string' && typeof body.method === 'string';
      if (!valid) return respond(res, typeof body?.rpcId === 'string' ? body.rpcId : 'invalid-request', badRequest('invalid client-request message'));
      if (body.method !== endpoint) return respond(res, body.rpcId, badRequest(`method ${JSON.stringify(body.method)} does not match endpoint ${JSON.stringify(endpoint)}`));
      respond(res, body.rpcId, await handle(endpoint, body.payload));
    },
  };
}
