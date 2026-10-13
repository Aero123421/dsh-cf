import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { CfError, demand, nonce, timeout, boundedJson } from './common.js';

const AUTH = 'https://dash.cloudflare.com/oauth2/auth';
const TOKEN = 'https://dash.cloudflare.com/oauth2/token';
const REVOKE = 'https://dash.cloudflare.com/oauth2/revoke';
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Public-client PKCE only. Management grants live in memory, never in the status snapshot. */
export class OAuth {
  constructor({ fetchImpl = fetch, onToken = () => {}, onState = () => {} } = {}) {
    this.fetch = fetchImpl; this.onToken = onToken; this.onState = onState; this.pending = null; this.server = null; this.grantClientId = null; this.generation = 0;
  }
  async begin({ clientId, scopes, port = 8789 }) {
    demand(typeof clientId === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(clientId), 'OAUTH_CLIENT', 'Register a public Cloudflare OAuth client or configure your own Client ID first.');
    demand(Array.isArray(scopes) && scopes.length > 0 && scopes.every(s => typeof s === 'string' && /^[A-Za-z0-9._-]{1,180}$/.test(s)), 'OAUTH_SCOPES', 'Enter the exact scope IDs registered for this OAuth client.');
    demand(!scopes.some(s => s === 'offline_access' || s === 'offline'), 'OAUTH_SCOPES', 'Persistent refresh grants are not requested by this plugin.');
    demand(Number.isInteger(port) && port >= 1024 && port <= 65535, 'OAUTH_PORT', 'Choose a loopback callback port between 1024 and 65535.');
    const generation = ++this.generation;
    await this.clearAttempt();
    demand(generation === this.generation, 'OAUTH_EXPIRED', 'This authorization was superseded or cancelled.');
    const verifier = nonce(); const state = nonce();
    const redirectUri = `http://127.0.0.1:${port}/dsh-cf/oauth/callback`;
    const server = createServer((req, res) => {
      const reply = (status, text) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" }); res.end(text); };
      if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${port}`) return reply(400, 'Invalid callback.');
      let incoming; try { incoming = new URL(req.url, redirectUri); } catch { return reply(400, 'Invalid callback.'); }
      if (incoming.pathname !== '/dsh-cf/oauth/callback') return reply(404, 'Not found.');
      void this.finish(incoming.href).then(() => reply(200, 'Cloudflare connected. Return to DeepSeek Harness.')).catch(() => reply(400, 'Authorization was not completed. Return to DSH and retry.'));
    });
    this.server = server;
    const pending = { state, verifier, clientId, redirectUri, expires: Date.now() + 5 * 60_000, timer: null, used: false, abort: new AbortController(), server };
    this.pending = pending; // Own the listener before listen() can yield to cancellation.
    try {
      await new Promise((resolve, reject) => {
        const finish = error => { server.removeListener('error', failed); pending.abort.signal.removeEventListener('abort', aborted); error ? reject(error) : resolve(); };
        const failed = error => finish(error);
        const aborted = () => finish(pending.abort.signal.reason);
        server.once('error', failed); pending.abort.signal.addEventListener('abort', aborted, { once: true });
        server.listen({ port, host: '127.0.0.1', signal: pending.abort.signal }, () => finish());
      });
      pending.abort.signal.throwIfAborted();
      demand(generation === this.generation && this.pending === pending, 'OAUTH_EXPIRED', 'This authorization was superseded or cancelled.');
    } catch (error) {
      if (this.pending === pending) await this.cancel();
      throw error;
    }
    pending.timer = setTimeout(() => { if (this.pending === pending) { void this.cancel(); this.onState('expired'); } }, 5 * 60_000); pending.timer.unref();
    const url = new URL(AUTH);
    for (const [key, value] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: scopes.join(' '), state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })) url.searchParams.set(key, value);
    this.onState('waiting');
    return { authorizationUrl: url.href, redirectUri, expiresAt: this.pending.expires };
  }
  async finish(redirectUrl) {
    demand(typeof redirectUrl === 'string' && redirectUrl.length < 16_384, 'OAUTH_CALLBACK', 'Paste the complete callback URL from the authorization attempt.');
    const pending = this.pending;
    demand(pending && !pending.used && Date.now() < pending.expires, 'OAUTH_EXPIRED', 'This authorization has expired or was already used. Start again.');
    let url; try { url = new URL(redirectUrl); } catch { throw new CfError('OAUTH_CALLBACK', 'Invalid callback URL.'); }
    const expected = new URL(pending.redirectUri);
    demand(url.origin === expected.origin && url.pathname === expected.pathname && !url.hash && !url.username && !url.password, 'OAUTH_CALLBACK', 'Callback destination does not match this attempt.');
    demand(url.searchParams.getAll('state').length === 1 && equal(url.searchParams.get('state'), pending.state), 'OAUTH_STATE', 'Authorization state mismatch.');
    pending.used = true; clearTimeout(pending.timer);
    try {
      demand(!url.searchParams.has('error'), 'OAUTH_DENIED', 'Cloudflare authorization was declined.');
      const code = url.searchParams.get('code');
      demand(url.searchParams.getAll('code').length === 1 && typeof code === 'string' && code.length > 0, 'OAUTH_CALLBACK', 'The authorization code is missing.');
      const response = await this.fetch(TOKEN, {
        method: 'POST', redirect: 'error', signal: timeout(pending.abort.signal),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: pending.clientId, redirect_uri: pending.redirectUri, code, code_verifier: pending.verifier }),
      });
      demand(response.ok, 'OAUTH_EXCHANGE', 'Cloudflare rejected the authorization exchange. Check client registration, callback URI, and scopes.');
      const body = await boundedJson(response, 64 * 1024);
      demand(typeof body.access_token === 'string' && body.token_type?.toLowerCase() === 'bearer' && Number.isFinite(body.expires_in) && body.expires_in > 0, 'OAUTH_EXCHANGE', 'Cloudflare returned an invalid access grant.');
      // Ignore unsolicited refresh/id tokens. Only the expiring API grant is retained.
      pending.abort.signal.throwIfAborted();
      demand(this.pending === pending, 'OAUTH_EXPIRED', 'The authorization attempt was superseded.');
      await this.onToken(body.access_token, Date.now() + body.expires_in * 1000, pending.abort.signal);
      pending.abort.signal.throwIfAborted();
      // A public client identifies itself at the revocation endpoint (RFC 7009 §2.1).
      this.grantClientId = pending.clientId;
      this.onState('complete'); return { connected: true };
    } finally {
      if (this.pending === pending) this.pending = null;
      // close() does not wait for the callback response to finish (avoids a self-deadlock).
      if (this.server === pending.server) this.server = null;
      pending.server.close();
    }
  }
  async revoke(token) {
    if (!token) return;
    const clientId = this.grantClientId;
    demand(typeof clientId === 'string' && clientId.length > 0, 'OAUTH_REVOKE', 'The OAuth client for this grant is unknown. The local grant can still be forgotten.');
    const response = await this.fetch(REVOKE, { method: 'POST', redirect: 'error', signal: timeout(undefined), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token, token_type_hint: 'access_token', client_id: clientId }) });
    demand(response.ok, 'OAUTH_REVOKE', 'Cloudflare did not confirm grant revocation. The local grant can still be forgotten.');
  }
  async cancel() {
    this.generation++;
    await this.clearAttempt();
  }
  async clearAttempt() {
    const pending = this.pending; this.pending = null;
    const server = this.server; this.server = null;
    if (pending) { clearTimeout(pending.timer); pending.abort.abort(new DOMException('Cancelled', 'AbortError')); }
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}
