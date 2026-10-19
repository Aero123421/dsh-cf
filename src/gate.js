import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Transform } from 'node:stream';
import { demand, CfError, json } from './common.js';

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'";
const PAGE_STYLE = ':root{color-scheme:light dark;--bg:#fff;--fg:#1d1d1f;--muted:#5c5c63;--link:#0b57d0}@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececf0;--muted:#a8a8b0;--link:#8ab4f8}}body{font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg);max-width:540px;margin:12vh auto;padding:24px}h1{font-size:1.35rem;line-height:1.4}a{color:var(--link)}';
// Pages for a browser opening the site. English and Japanese; each says whose problem it is and what to do next.
const PAGES = {
  signin: { status: 401, en: ['Could not open DSH', 'Cloudflare sign-in could not be verified. Sign in again with the allowed email address.', 'Sign in again', '/cdn-cgi/access/logout'], ja: ['DSHを開けませんでした', 'Cloudflareのログインを確認できませんでした。許可されたメールアドレスでログインし直してください。', 'ログインし直す', '/cdn-cgi/access/logout'] },
  owner: { status: 401, en: ['This account is not allowed', 'You are signed in with an account that is not allowed to use this DSH. Sign out, then sign in with the email address that was set up as the owner.', 'Sign out', '/cdn-cgi/access/logout'], ja: ['このアカウントは許可されていません', '許可されていないアカウントでログインしています。ログアウトして、所有者として設定したメールアドレスでログインし直してください。', 'ログアウトする', '/cdn-cgi/access/logout'] },
  unavailable: { status: 503, en: ['Sign-in could not be checked', 'This PC could not verify the sign-in with Cloudflare. You do not need to sign in again; try again in a minute.', 'Try again', '/'], ja: ['ログインを確認できませんでした', 'このPCからCloudflareにログインの確認ができませんでした。ログインし直す必要はありません。しばらくしてからもう一度お試しください。', 'もう一度開く', '/'] },
  local: { status: 502, en: ['Could not reach DSH', 'The connection to DSH on this PC could not be verified. DSH may be restarting; try again shortly.', 'Try again', '/'], ja: ['DSHに接続できませんでした', 'このPCのDSHとの接続を確認できませんでした。DSHが再起動中の可能性があります。しばらくしてからもう一度お試しください。', 'もう一度開く', '/'] },
};
function page(res, kind, req, instanceId) {
  const japanese = String(req.headers['accept-language'] ?? '').startsWith('ja');
  const [title, message, label, href] = PAGES[kind][japanese ? 'ja' : 'en'];
  res.writeHead(PAGES[kind].status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': PAGE_CSP, 'x-dsh-cf-gate': instanceId });
  res.end(`<!doctype html><html lang="${japanese ? 'ja' : 'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light dark"><title>${title}</title><style>${PAGE_STYLE}</style><body><h1>${title}</h1><p>${message}</p><p><a href="${href}">${label}</a></p></body></html>`);
}

function denied(res, status, message, instanceId) {
  res.setHeader('x-dsh-cf-gate', instanceId); json(res, status, { error: message });
}
function rejectSocket(socket, status) {
  // A rejected upgrade has no HTTP server timeout and the peer may never send FIN.
  // Flush the small response, then close both halves; bound even a stalled flush.
  const timer = setTimeout(() => socket.destroy(), 1000); timer.unref();
  socket.once('close', () => clearTimeout(timer));
  socket.once('error', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
}
function pathOf(req) {
  demand(typeof req.url === 'string' && req.url.startsWith('/') && !req.url.startsWith('//') && !/[\\\x00-\x20]/.test(req.url), 'PATH', 'Invalid request target.');
  const url = new URL(req.url, 'https://local.invalid');
  demand(!url.searchParams.has('token'), 'PATH', 'Public launch tokens are not accepted.');
  let decoded; try { decoded = decodeURIComponent(url.pathname); } catch { throw new CfError('PATH', 'Invalid path encoding.'); }
  // Reject double-encoding, encoded separators, and dot-segment aliases at the trust boundary.
  demand(!/[\\\x00-\x20%]/.test(decoded) && !/%(?:2f|5c|2e)/i.test(url.pathname), 'PATH', 'Ambiguous path encoding.');
  const readStatus = req.method === 'POST' && url.pathname === '/dsh-cf/status';
  demand((!decoded.toLowerCase().startsWith('/dsh-cf') || readStatus) && !decoded.toLowerCase().startsWith('/cdn-cgi/'), 'MANAGEMENT', 'Management is local only.');
  return url;
}
export function browserFence(req, host, upgrade = false) {
  demand(req.headers.host === host || req.headers.host === `${host}:443`, 'HOST', 'Unexpected public host.');
  const origin = req.headers.origin;
  if (origin !== undefined) demand(origin === `https://${host}`, 'ORIGIN', 'Cross-origin requests are not allowed.');
  const url = pathOf(req);
  // Access redirects cross-site into a document. Only safe entry navigations get this exception.
  const entry = req.method === 'GET' && url.pathname === '/' && req.headers['sec-fetch-mode'] === 'navigate' && origin === undefined;
  demand(req.headers['sec-fetch-site'] !== 'cross-site' || entry, 'ORIGIN', 'Cross-site requests are not allowed.');
  if (upgrade || !['GET', 'HEAD'].includes(req.method)) demand(origin === `https://${host}`, 'ORIGIN', 'A same-origin browser request is required.');
  demand(!url.pathname.startsWith('/dsh-cf') || (req.method === 'POST' && url.pathname === '/dsh-cf/status'), 'MANAGEMENT', 'Only read-only status is available over this public connection.');
  return url;
}
function cleanHeaders(headers, { host, cookie, upgrade = false, response = false } = {}) {
  const nominated = new Set(String(headers.connection || '').split(',').map(x => x.trim().toLowerCase()));
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (HOP.has(key) || nominated.has(key) || value === undefined) continue;
    if (!response && (key === 'host' || key === 'cookie' || key === 'authorization' || key === 'forwarded' || key === 'via' || key.startsWith('cf-') || key.startsWith('x-forwarded-') || key === 'x-real-ip')) continue;
    if (response && key === 'set-cookie') continue; // DSH's bearer cookie must remain server-side.
    out[name] = value;
  }
  if (!response) { out.host = host; out.cookie = cookie; }
  if (upgrade) { out.connection = 'Upgrade'; out.upgrade = 'websocket'; }
  return out;
}

/** Whole-surface Access gate: HTTP, uploads, downloads, SSE, and WebSocket upgrades. */
export class Gate {
  // Defaults follow the Cloudflare edge: 100 MB request bodies on Free/Pro plans and a 100 s wait for
  // origin response headers (HTTP 524). Streams are re-authenticated at JWT expiry or after 15 minutes.
  // HTTP requests and WebSockets have separate budgets so long-lived sockets cannot starve page loads.
  constructor({ host, instanceId, adapter, verify, onEvidence = () => {}, onFault = () => {}, onHealthy = () => {}, maximumBodyBytes = 100 * 1024 * 1024, maximumStreamMs = 15 * 60_000, upstreamHeadersMs = 100_000, maximumRequests = 256, maximumWebSockets = 64 }) {
    this.host = host; this.instanceId = instanceId; this.adapter = adapter; this.verify = verify; this.onEvidence = onEvidence; this.onFault = onFault; this.onHealthy = onHealthy;
    this.maximumBodyBytes = maximumBodyBytes; this.maximumStreamMs = maximumStreamMs; this.upstreamHeadersMs = upstreamHeadersMs;
    this.maximumRequests = maximumRequests; this.maximumWebSockets = maximumWebSockets;
    this.closing = false; this.active = new Set(); this.sockets = new Set(); this.websockets = new Set(); this.requests = 0; this.upgrades = 0;
  }
  async start(port = 0) {
    this.server = createServer({ maxHeaderSize: 32 * 1024 }, (req, res) => { void this.http(req, res); });
    this.server.on('connection', socket => { this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); });
    this.server.on('upgrade', (req, socket, head) => { void this.upgrade(req, socket, head); });
    this.server.on('clientError', (_error, socket) => rejectSocket(socket, '400 Bad Request'));
    // Request headers must arrive promptly; a slow upload body is bounded by the per-stream lifetime instead
    // of Node's whole-request timeout, which would cut legitimate large uploads on slow links.
    this.server.headersTimeout = 15_000; this.server.requestTimeout = this.maximumStreamMs; this.server.maxRequestsPerSocket = 1000;
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, '127.0.0.1', resolve); });
    this.server.on('error', () => {});
    this.port = this.server.address().port; return this.port;
  }
  async authenticate(req, upgrade) {
    demand(!this.closing && typeof this.verify === 'function', 'AUTH', 'Access protection is not ready.');
    const url = browserFence(req, this.host, upgrade);
    const identity = await this.verify(req.headers['cf-access-jwt-assertion']);
    demand(!this.closing && identity && Number.isFinite(identity.expiresAt) && identity.expiresAt > Date.now(), 'AUTH', 'Authentication expired.');
    return { identity, url };
  }
  /** Reserve one slot of the `requests` or `upgrades` budget until the emitter closes and its pending work has finished. */
  reserve(emitter, budget) {
    const limit = budget === 'upgrades' ? this.maximumWebSockets : this.maximumRequests;
    if (this[budget] >= limit) return null;
    this[budget]++;
    let pending = true, closed = emitter.destroyed, released = false;
    const release = () => { if (closed && !pending && !released) { released = true; this[budget]--; } };
    emitter.once('close', () => { closed = true; release(); });
    // A disconnected client must not free capacity while its authentication/session work is pending.
    return () => { pending = false; release(); };
  }
  /** A DSH-side failure while preparing a request is reported like an upstream failure. */
  noteLocalFailure(error, channel) {
    if (error instanceof CfError && error.code === 'AUTH_UNAVAILABLE') return this.reportFault({ status: 'verification-unavailable', channel });
    if (error instanceof CfError && error.code.startsWith('DSH_')) this.reportFault({ status: error.code === 'DSH_AUTH' ? 'auth-rejected' : 'upstream-failed', channel });
  }
  async http(req, res) {
    const admitted = this.reserve(res, 'requests');
    if (!admitted) return denied(res, 503, 'Too many active requests.', this.instanceId);
    try {
      const { identity, url } = await this.authenticate(req, false);
      if (res.destroyed) return;
      const length = req.headers['content-length'];
      demand(!length || (/^\d+$/.test(length) && Number(length) <= this.maximumBodyBytes), 'BODY', 'Upload exceeds the request limit.');
      // The DSH session exchange is lazy: each request is already Access-verified, and the loopback exchange happens here.
      const channel = url.pathname.startsWith('/api/') ? 'api' : 'http';
      let target, cookie;
      try { [target, cookie] = await Promise.all([this.adapter.target(this.host), this.adapter.cookie(this.host)]); }
      catch (error) { this.noteLocalFailure(error, channel); throw error; }
      demand(!this.closing && !res.destroyed && identity.expiresAt > Date.now(), 'AUTH', 'Request expired or stopped.');
      this.onEvidence('owner');
      const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const upstream = transport({ ...target, method: req.method, path: `${url.pathname}${url.search}`, headers: cleanHeaders(req.headers, { host: this.host, cookie }) });
      const stop = () => { upstream.destroy(); if (!res.writableEnded) res.destroy(); };
      this.active.add(stop);
      const lifetime = setTimeout(stop, Math.max(1, Math.min(identity.expiresAt - Date.now(), this.maximumStreamMs))); lifetime.unref();
      // The response-header window starts once the whole request body has been sent: a slow upload is bounded
      // by the stream lifetime and body limit, not by DSH's processing time.
      let handshake;
      upstream.once('finish', () => { if (!upstream.destroyed) { handshake = setTimeout(() => upstream.destroy(new Error('Upstream timeout')), this.upstreamHeadersMs); handshake.unref(); } });
      res.once('close', () => { clearTimeout(lifetime); clearTimeout(handshake); this.active.delete(stop); upstream.destroy(); });
      upstream.once('response', response => {
        clearTimeout(handshake);
        if (response.statusCode === 401) this.adapter.invalidate(); // Never replay a possibly executed POST.
        if (response.statusCode === 401) this.reportFault({ status: 'auth-rejected', channel });
        else if (response.statusCode >= 500) this.reportFault({ status: 'upstream-failed', channel, httpStatus: response.statusCode });
        else {
          this.onHealthy();
          if (response.statusCode >= 200 && response.statusCode < 300) {
            if (url.pathname === '/') this.onEvidence('http');
            if (url.pathname.startsWith('/api/')) this.onEvidence('api');
          }
        }
        const headers = cleanHeaders(response.headers, { response: true });
        headers['cache-control'] = 'no-store'; headers['referrer-policy'] = 'no-referrer';
        res.writeHead(response.statusCode, headers); response.pipe(res);
        response.once('error', () => res.destroy());
      });
      upstream.once('error', () => {
        // A client abort or our own close is silence, not an upstream outage. Denials we write ourselves never reach here.
        if (!this.closing && !req.aborted && !res.destroyed) this.reportFault({ status: 'upstream-failed', channel });
        if (!res.headersSent) denied(res, 502, 'DSH upstream is unavailable.', this.instanceId); else res.destroy();
      });
      let bytes = 0;
      const limit = new Transform({ transform: (chunk, _encoding, done) => { bytes += chunk.length; done(bytes > this.maximumBodyBytes ? new Error('Body limit') : null, chunk); } });
      limit.once('error', () => { if (!res.headersSent) denied(res, 413, 'Upload exceeds the request limit.', this.instanceId); upstream.destroy(); });
      req.once('aborted', () => upstream.destroy()); req.once('error', () => upstream.destroy());
      req.pipe(limit).pipe(upstream);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      const code = e instanceof CfError ? e.code : '';
      if (code === 'AUTH_UNAVAILABLE') this.noteLocalFailure(e, 'http');
      const status = code === 'BODY' ? 413 : ['HOST', 'ORIGIN', 'PATH', 'MANAGEMENT'].includes(code) ? 403 : code === 'AUTH_UNAVAILABLE' ? 503 : code.startsWith('DSH_') ? 502 : 401;
      const navigation = req.method === 'GET' && req.url === '/' && String(req.headers.accept ?? '').includes('text/html');
      if (navigation && [401, 502, 503].includes(status)) return page(res, status === 503 ? 'unavailable' : status === 502 ? 'local' : code === 'AUTH_OWNER' ? 'owner' : 'signin', req, this.instanceId);
      denied(res, status, status === 403 ? 'Request not permitted.' : status === 503 ? 'Sign-in verification is temporarily unavailable.' : status === 502 ? 'DSH is unavailable.' : status === 413 ? 'Upload exceeds the request limit.' : 'Access or DSH verification required.', this.instanceId);
    } finally { admitted(); }
  }
  async upgrade(req, socket, head) {
    socket.on('error', () => {});
    socket.once('end', () => socket.destroy()); // An upgraded HTTP socket may otherwise stay half-open.
    // Reserve before authentication/session exchange can yield.
    const admitted = this.reserve(socket, 'upgrades');
    if (!admitted) { rejectSocket(socket, '503 Service Unavailable'); return; }
    let identity, url;
    try {
      demand(String(req.headers.upgrade).toLowerCase() === 'websocket', 'UPGRADE', 'Unsupported upgrade.');
      ({ identity, url } = await this.authenticate(req, true));
    } catch (error) { rejectSocket(socket, error instanceof CfError && error.code === 'AUTH_UNAVAILABLE' ? '503 Service Unavailable' : '401 Unauthorized'); this.noteLocalFailure(error, 'websocket'); admitted(); return; }
    try {
      if (socket.destroyed || this.closing) return;
      let target, cookie;
      try { [target, cookie] = await Promise.all([this.adapter.target(this.host), this.adapter.cookie(this.host)]); }
      catch (error) { this.noteLocalFailure(error, 'websocket'); throw error; }
      if (socket.destroyed || this.closing) return;
      demand(identity.expiresAt > Date.now(), 'AUTH', 'Authentication expired during session exchange.');
      this.onEvidence('owner');
      const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const request = transport({ ...target, method: 'GET', path: `${url.pathname}${url.search}`, headers: cleanHeaders(req.headers, { host: this.host, cookie, upgrade: true }) });
      let remote, reported = false, intentional = null;
      const report = (status, extra) => {
        if (reported || this.closing) return;
        reported = true; this.websockets.delete(socket);
        // A stream that ends (a closed tab, the lifetime cap, a DSH restart) is not a fault.
        if (status !== 'websocket-closed') this.reportFault({ status, channel: 'websocket', ...extra });
      };
      const stop = kind => { if (kind) intentional = kind; socket.destroy(); remote?.destroy(); request.destroy(); };
      this.active.add(stop);
      const timer = setTimeout(() => stop('websocket-closed'), Math.max(1, Math.min(identity.expiresAt - Date.now(), this.maximumStreamMs))); timer.unref();
      const handshake = setTimeout(() => stop('upstream-failed'), 15_000); handshake.unref();
      socket.once('close', () => { clearTimeout(timer); clearTimeout(handshake); this.active.delete(stop); report(intentional || 'websocket-closed'); remote?.destroy(); request.destroy(); });
      request.once('upgrade', (response, upstream, upstreamHead) => {
        clearTimeout(handshake); remote = upstream;
        if (this.closing || socket.destroyed) return stop();
        const headers = cleanHeaders(response.headers, { upgrade: true, response: true });
        const lines = ['HTTP/1.1 101 Switching Protocols'];
        for (const [key, value] of Object.entries(headers)) for (const v of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${v}`);
        socket.write(lines.join('\r\n') + '\r\n\r\n');
        if (upstreamHead.length) socket.write(upstreamHead); if (head.length) upstream.write(head);
        upstream.on('error', () => { report(intentional || 'upstream-failed'); stop(); });
        upstream.once('close', () => { report(intentional || 'websocket-closed'); socket.destroy(); });
        this.websockets.add(socket); socket.pipe(upstream).pipe(socket); this.onHealthy(); this.onEvidence('websocket');
      });
      request.once('response', response => {
        if (response.statusCode === 401) { this.adapter.invalidate(); report('auth-rejected'); }
        else if (response.statusCode >= 500) report('upstream-failed', { httpStatus: response.statusCode });
        else report(intentional || 'upstream-failed');
        if (!socket.destroyed) socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage || 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        response.resume(); stop();
      });
      request.once('error', () => { if (!socket.destroyed || intentional) report(intentional || 'upstream-failed'); stop(); }); request.end();
    } catch { socket.destroy(); }
    finally { admitted(); }
  }
  reportFault(event) { if (!this.closing) this.onFault(event); }
  async close() {
    this.closing = true;
    for (const stop of this.active) stop();
    for (const socket of this.sockets) socket.destroy();
    this.websockets.clear();
    if (this.server) await new Promise(resolve => this.server.close(resolve));
    this.adapter.invalidate();
  }
}
