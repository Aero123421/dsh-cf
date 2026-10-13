import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Transform } from 'node:stream';
import { demand, CfError, json, nonce } from './common.js';

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const VERIFY_PATH = '/.well-known/dsh-cf/verify';
export const DIAGNOSTIC_PATH = VERIFY_PATH;

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
  const entry = req.method === 'GET' && [ '/', VERIFY_PATH ].includes(url.pathname) && req.headers['sec-fetch-mode'] === 'navigate' && origin === undefined;
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
  constructor({ host, instanceId, adapter, verify, onEvidence = () => {}, maximumBodyBytes = 100 * 1024 * 1024, maximumStreamMs = 15 * 60_000, upstreamHeadersMs = 100_000 }) {
    this.host = host; this.instanceId = instanceId; this.adapter = adapter; this.verify = verify; this.onEvidence = onEvidence;
    this.maximumBodyBytes = maximumBodyBytes; this.maximumStreamMs = maximumStreamMs; this.upstreamHeadersMs = upstreamHeadersMs;
    this.proofNonce = nonce(); this.enabled = false; this.closing = false; this.active = new Set(); this.sockets = new Set(); this.requests = 0;
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
    this.server.on('error', () => { this.enabled = false; });
    this.port = this.server.address().port; return this.port;
  }
  async authenticate(req, upgrade) {
    demand(!this.closing && typeof this.verify === 'function', 'AUTH', 'Access protection is not ready.');
    const url = browserFence(req, this.host, upgrade);
    const identity = await this.verify(req.headers['cf-access-jwt-assertion']);
    demand(!this.closing && identity && Number.isFinite(identity.expiresAt) && identity.expiresAt > Date.now(), 'AUTH', 'Authentication expired.');
    return { identity, url };
  }
  reserve(emitter) {
    if (this.requests >= 64) return null;
    this.requests++;
    let pending = true, closed = emitter.destroyed, released = false;
    const release = () => { if (closed && !pending && !released) { released = true; this.requests--; } };
    emitter.once('close', () => { closed = true; release(); });
    // A disconnected client must not free capacity while its authentication/session work is pending.
    return () => { pending = false; release(); };
  }
  async http(req, res) {
    const admitted = this.reserve(res);
    if (!admitted) return denied(res, 503, 'Too many active requests.', this.instanceId);
    try {
      const { identity, url } = await this.authenticate(req, false);
      if (res.destroyed) return;
      if (url.pathname === VERIFY_PATH) {
        demand(req.method === 'GET' && url.searchParams.get('challenge') === this.proofNonce, 'PROOF', 'Open the current verification link from DSH settings.');
        // Prove normal DSH authentication before making any application route usable.
        await this.adapter.cookie(this.host);
        demand(!this.closing && !res.destroyed && identity.expiresAt > Date.now(), 'AUTH', 'Request expired or stopped.');
        this.enabled = true; this.onEvidence('owner');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" });
        res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DSH · Access verified</title><body style="font:16px system-ui;max-width:600px;margin:12vh auto;padding:24px;line-height:1.7"><h1>✓ 本人認証を確認しました</h1><p>Cloudflare AccessとDSHの正規セッション交換に成功しました。</p><p>次にDSHを開くと、API・WebSocketの実通信を確認します。</p><a style="display:inline-block;padding:12px 20px;border:1px solid;border-radius:8px" href="/">DSHを開いて接続確認</a><p>設定画面に戻ると、確認済みの項目にチェックが付きます。</p></body></html>');
        return;
      }
      demand(this.enabled, 'PROOF', 'Complete browser verification from the DSH settings panel first.');
      this.onEvidence('owner');
      const length = req.headers['content-length'];
      demand(!length || (/^\d+$/.test(length) && Number(length) <= this.maximumBodyBytes), 'BODY', 'Upload exceeds the request limit.');
      const [target, cookie] = await Promise.all([this.adapter.target(this.host), this.adapter.cookie(this.host)]);
      demand(!this.closing && !res.destroyed && identity.expiresAt > Date.now(), 'AUTH', 'Request expired or stopped.');
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
        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (url.pathname === '/') this.onEvidence('http');
          if (url.pathname.startsWith('/api/')) this.onEvidence('api');
        }
        const headers = cleanHeaders(response.headers, { response: true });
        headers['cache-control'] = 'no-store'; headers['referrer-policy'] = 'no-referrer';
        res.writeHead(response.statusCode, headers); response.pipe(res);
        response.once('error', () => res.destroy());
      });
      upstream.once('error', () => { if (!res.headersSent) denied(res, 502, 'DSH upstream is unavailable.', this.instanceId); else res.destroy(); });
      let bytes = 0;
      const limit = new Transform({ transform: (chunk, _encoding, done) => { bytes += chunk.length; done(bytes > this.maximumBodyBytes ? new Error('Body limit') : null, chunk); } });
      limit.once('error', () => { if (!res.headersSent) denied(res, 413, 'Upload exceeds the request limit.', this.instanceId); upstream.destroy(); });
      req.once('aborted', () => upstream.destroy()); req.once('error', () => upstream.destroy());
      req.pipe(limit).pipe(upstream);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      const status = e instanceof CfError && e.code === 'BODY' ? 413 : e instanceof CfError && ['HOST', 'ORIGIN', 'PATH', 'MANAGEMENT'].includes(e.code) ? 403 : 401;
      denied(res, status, status === 403 ? 'Request not permitted.' : 'Access or DSH verification required.', this.instanceId);
    } finally { admitted(); }
  }
  async upgrade(req, socket, head) {
    socket.on('error', () => {});
    socket.once('end', () => socket.destroy()); // An upgraded HTTP socket may otherwise stay half-open.
    // Share HTTP's budget and reserve before authentication/session exchange can yield.
    const admitted = this.reserve(socket);
    if (!admitted) { rejectSocket(socket, '503 Service Unavailable'); return; }
    let identity, url;
    try {
      demand(String(req.headers.upgrade).toLowerCase() === 'websocket', 'UPGRADE', 'Unsupported upgrade.');
      ({ identity, url } = await this.authenticate(req, true));
      demand(this.enabled, 'PROOF', 'Verification required.');
    } catch { rejectSocket(socket, '401 Unauthorized'); admitted(); return; }
    try {
      if (socket.destroyed || this.closing) return;
      const [target, cookie] = await Promise.all([this.adapter.target(this.host), this.adapter.cookie(this.host)]);
      if (socket.destroyed || this.closing) return;
      demand(identity.expiresAt > Date.now(), 'AUTH', 'Authentication expired during session exchange.');
      const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const request = transport({ ...target, method: 'GET', path: `${url.pathname}${url.search}`, headers: cleanHeaders(req.headers, { host: this.host, cookie, upgrade: true }) });
      let remote;
      const stop = () => { socket.destroy(); remote?.destroy(); request.destroy(); };
      this.active.add(stop);
      const timer = setTimeout(stop, Math.max(1, Math.min(identity.expiresAt - Date.now(), this.maximumStreamMs))); timer.unref();
      const handshake = setTimeout(stop, 15_000); handshake.unref();
      socket.once('close', () => { clearTimeout(timer); clearTimeout(handshake); this.active.delete(stop); remote?.destroy(); request.destroy(); });
      request.once('upgrade', (response, upstream, upstreamHead) => {
        clearTimeout(handshake); remote = upstream;
        if (this.closing || socket.destroyed) return stop();
        const headers = cleanHeaders(response.headers, { upgrade: true, response: true });
        const lines = ['HTTP/1.1 101 Switching Protocols'];
        for (const [key, value] of Object.entries(headers)) for (const v of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${v}`);
        socket.write(lines.join('\r\n') + '\r\n\r\n');
        if (upstreamHead.length) socket.write(upstreamHead); if (head.length) upstream.write(head);
        upstream.on('error', stop); upstream.once('close', () => socket.destroy());
        socket.pipe(upstream).pipe(socket); this.onEvidence('websocket');
      });
      request.once('response', response => { if (response.statusCode === 401) this.adapter.invalidate(); response.resume(); stop(); });
      request.once('error', stop); request.end();
    } catch { socket.destroy(); }
    finally { admitted(); }
  }
  async close() {
    this.closing = true; this.enabled = false;
    for (const stop of this.active) stop();
    for (const socket of this.sockets) socket.destroy();
    if (this.server) await new Promise(resolve => this.server.close(resolve));
    this.adapter.invalidate();
  }
}
