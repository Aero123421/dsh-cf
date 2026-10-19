import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
export const HOST = 'dsh.example.com';
export const ACCOUNT = 'a'.repeat(32), ZONE = 'b'.repeat(32), AUD = 'c'.repeat(64);
export const TUNNEL = '11111111-1111-4111-8111-111111111111';
/** Base64 JSON `{a, t, s}` in the shape cloudflared accepts. Tests keep this string exactly; the store does not re-encode it. */
/** Pad a short fixture secret to the 32-byte minimum stored by `writeToken`. */
export function tokenSecret(seed) {
  const raw = Buffer.from(seed);
  return raw.length >= 32 ? raw : Buffer.concat([raw, Buffer.alloc(32 - raw.length, 0x3c)]);
}
export function connectorToken({ accountId = ACCOUNT, tunnelId = TUNNEL, secret = Buffer.from('0123456789abcdef0123456789abcdef') } = {}) {
  const bytes = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret));
  return Buffer.from(JSON.stringify({ a: accountId, t: tunnelId, s: bytes.toString('base64') })).toString('base64');
}
export const SETUP = { accountId: ACCOUNT, zoneId: ZONE, hostname: HOST, ownerEmail: 'owner@example.com', idpId: 'provider-1', teamDomain: 'team.cloudflareaccess.com' };
export const reply = result => Response.json({ success: true, result, result_info: { total_pages: 1 } });
export async function listen(server, host = '127.0.0.1') { server.listen(0, host); await once(server, 'listening'); return server.address().port; }
export async function freePort() { const s = createServer(); const port = await listen(s); await new Promise(r => s.close(r)); return port; }
export function http(port, { path = '/', method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }); req.on('error', reject); req.end(body);
  });
}
export async function dshFixture({ host = '127.0.0.1', trustedHosts = ['keep.example.com'] } = {}) {
  const calls = [], sockets = new Set(), trusted = new Set();
  let launch = 'process-secret-one', exchanges = 0;
  const cookie = host => `dsh-auth-fixture=${createHash('sha256').update(host + launch).digest('hex')}`;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    calls.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    const url = new URL(req.url, 'http://fixture.invalid');
    if (url.pathname === '/' && url.searchParams.get('token') === launch) {
      exchanges++; res.writeHead(303, { location: './', 'set-cookie': `${cookie(req.headers.host)}; Path=/; HttpOnly; SameSite=Strict` }); res.end(); return;
    }
    if (!trusted.has(req.headers.host) || req.headers.cookie !== cookie(req.headers.host)) { res.writeHead(401); res.end('unauthorized'); return; }
    if (url.pathname === '/api/fail') { res.writeHead(401); res.end('unauthorized'); return; }
    if (url.pathname === '/api/down' || url.pathname === '/down') { res.writeHead(503); res.end('unavailable'); return; }
    if (url.pathname === '/api/slow') { await new Promise(r => setTimeout(r, Number(url.searchParams.get('ms') || 300))); if (!res.destroyed) { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('slow-ok'); } return; }
    if (url.pathname === '/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: hello\n\n'); return; }
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'dsh-auth-leaked=NEVER-BROWSER; HttpOnly' }); res.end(JSON.stringify({ path: req.url, received: Buffer.concat(chunks).toString() }));
  });
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  server.on('upgrade', (req, socket, head) => {
    calls.push({ path: req.url, headers: req.headers, upgrade: true });
    if (!trusted.has(req.headers.host) || req.headers.cookie !== cookie(req.headers.host)) return socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
    if (new URL(req.url, 'http://fixture.invalid').pathname === '/api/down') return socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 11\r\n\r\nunavailable');
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    if (head.length) socket.write(head); socket.on('data', c => socket.write(c)); socket.on('error', () => {});
  });
  const port = await listen(server, host);
  const connection = { authenticatedUrl: base => `${base}?token=${launch}`, requestRejection: ({ headers }) => trusted.has(headers.host) ? 401 : 403 };
  const entry = { options: { name: '@deepseek-ai/dsh-client-connection' } }; let raw = { recovery: { retries: 3 }, ...(trustedHosts === null ? {} : { trustedHosts }) };
  const services = { connection, webServer: { host, port, protocol: 'http:' }, configEditor: { entries: () => [entry], edit: async (_entry, change) => { raw = change(raw); trusted.clear(); for (const h of Array.isArray(raw.trustedHosts) ? raw.trustedHosts : []) trusted.add(h); } } };
  return { calls, trusted, port, services, setRaw: value => { raw = value; trusted.clear(); for (const h of Array.isArray(raw.trustedHosts) ? raw.trustedHosts : []) trusted.add(h); }, ctx: { get: k => services[k] }, get raw() { return raw; }, get exchanges() { return exchanges; }, rotate: () => { launch = 'process-secret-two'; }, close: async () => { for (const s of sockets) s.destroy(); await new Promise(r => server.close(r)); } };
}
export function memoryStore() {
  return { dir: '/unused', state: { version: 1, instanceId: '550e8400-e29b-41d4-a716-446655440000', owned: {}, pending: null, setup: null, autoConnect: false }, token: null, saves: [], closed: false, async save() { this.saves.push(structuredClone(this.state)); }, async writeToken(value) { this.token = value; }, async hasToken() { return !!this.token; }, async clearToken() { this.token = null; }, async confirmHost() { this.state.hostReview = null; await this.save(); }, async close() { this.closed = true; } };
}
export function fakeCloudflare() {
  const token = connectorToken();
  const data = { writes: [], apps: [], tunnels: [], records: [], policies: new Map(), configs: new Map(), organization: { auth_domain: SETUP.teamDomain, name: 'Existing organization', mfa_config: { allowed_authenticators: ['biometrics', 'security_key'], session_duration: '8h', amr_matching_enabled: false }, mfa_required_for_all_apps: false }, fail: null };
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url); const p = u.pathname.replace('/client/v4', ''), method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    if (method !== 'GET') data.writes.push({ p, method, body });
    if (data.fail) { const result = await data.fail({ p, method, body }); if (result) return result; }
    if (p === '/accounts') return reply([{ id: ACCOUNT, name: 'Personal' }]);
    if (p === '/zones') return reply([{ id: ZONE, name: 'example.com', status: 'active', account: { id: ACCOUNT } }]);
    if (p === `/zones/${ZONE}`) return reply({ id: ZONE, name: 'example.com', status: 'active', account: { id: ACCOUNT } });
    if (p.endsWith('/access/organizations')) { if (method === 'PUT') data.organization = body; return reply(data.organization); }
    if (p.endsWith('/access/identity_providers')) return reply([{ id: 'provider-1', name: 'Email PIN', type: 'onetimepin' }]);
    if (p.endsWith('/access/apps')) {
      if (method === 'POST') { const app = { ...body, id: 'app-1', aud: AUD }; data.apps.push(app); data.policies.set(app.id, body.policies); return reply(app); } return reply(data.apps);
    }
    if (/\/access\/apps\/[^/]+\/policies$/.test(p)) return reply(data.policies.get(p.split('/').at(-2)) || []);
    if (/\/access\/apps\/[^/]+$/.test(p)) {
      const id = p.split('/').at(-1), item = data.apps.find(a => a.id === id);
      if (method === 'DELETE') data.apps = data.apps.filter(a => a.id !== id);
      if (method === 'PUT' && item) Object.assign(item, body);
      return item ? reply(item) : Response.json({ success: false }, { status: 404 });
    }
    if (p.endsWith('/cfd_tunnel')) { if (method === 'POST') { const tunnel = { ...body, id: TUNNEL, token }; data.tunnels.push(tunnel); return reply(tunnel); } return reply(data.tunnels); }
    if (p.endsWith('/configurations')) { const id = p.split('/').at(-2); if (method === 'PUT') data.configs.set(id, body); return reply(data.configs.get(id) || { config: {} }); }
    if (p.endsWith('/token')) return reply(token);
    if (/\/cfd_tunnel\/[^/]+\/connections$/.test(p)) { const id = p.split('/').at(-2); if (method === 'DELETE') data.connections = { ...data.connections, [id]: 0 }; return reply(null); }
    if (/\/cfd_tunnel\/[^/]+$/.test(p)) {
      const id = p.split('/').at(-1), item = data.tunnels.find(t => t.id === id);
      // Cloudflare refuses to delete a Tunnel that still has active connections.
      if (method === 'DELETE' && item && (data.connections?.[id] ?? 1) > 0) return Response.json({ success: false }, { status: 400 });
      if (method === 'DELETE') data.tunnels = data.tunnels.filter(t => t.id !== id); return item ? reply(item) : Response.json({ success: false }, { status: 404 });
    }
    if (p.endsWith('/dns_records')) { if (method === 'POST') { const record = { ...body, id: 'dns-1' }; data.records.push(record); return reply(record); } return reply(data.records); }
    if (/\/dns_records\/[^/]+$/.test(p)) { const id = p.split('/').at(-1), item = data.records.find(t => t.id === id); if (method === 'DELETE') data.records = data.records.filter(t => t.id !== id); return item ? reply(item) : Response.json({ success: false }, { status: 404 }); }
    throw new Error(`Unexpected test request: ${method} ${p}`);
  };
  return { data, fetchImpl };
}
