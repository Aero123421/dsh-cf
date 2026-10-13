import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
export const HOST = 'dsh.example.com';
export const ACCOUNT = 'a'.repeat(32), ZONE = 'b'.repeat(32), AUD = 'c'.repeat(64);
export const SETUP = { accountId: ACCOUNT, zoneId: ZONE, hostname: HOST, ownerEmail: 'owner@example.com', idpId: 'provider-1', teamDomain: 'team.cloudflareaccess.com' };
export const reply = result => Response.json({ success: true, result, result_info: { total_pages: 1 } });
export async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
export async function freePort() { const s = createServer(); const port = await listen(s); await new Promise(r => s.close(r)); return port; }
export function http(port, { path = '/', method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }); req.on('error', reject); req.end(body);
  });
}
export async function dshFixture() {
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
    if (url.pathname === '/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: hello\n\n'); return; }
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'dsh-auth-leaked=NEVER-BROWSER; HttpOnly' }); res.end(JSON.stringify({ path: req.url, received: Buffer.concat(chunks).toString() }));
  });
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  server.on('upgrade', (req, socket, head) => {
    calls.push({ path: req.url, headers: req.headers, upgrade: true });
    if (!trusted.has(req.headers.host) || req.headers.cookie !== cookie(req.headers.host)) return socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    if (head.length) socket.write(head); socket.on('data', c => socket.write(c)); socket.on('error', () => {});
  });
  const port = await listen(server);
  const connection = { authenticatedUrl: base => `${base}?token=${launch}`, requestRejection: ({ headers }) => trusted.has(headers.host) ? 401 : 403 };
  const entry = { options: { name: '@deepseek-ai/dsh-client-connection' } }; let raw = { recovery: { retries: 3 }, trustedHosts: ['keep.example.com'] };
  const services = { connection, webServer: { host: '127.0.0.1', port, protocol: 'http:' }, configEditor: { entries: () => [entry], edit: async (_entry, change) => { raw = change(raw); raw.trustedHosts.forEach(h => trusted.add(h)); } } };
  return { calls, trusted, port, ctx: { get: k => services[k] }, get raw() { return raw; }, get exchanges() { return exchanges; }, rotate: () => { launch = 'process-secret-two'; }, close: async () => { for (const s of sockets) s.destroy(); await new Promise(r => server.close(r)); } };
}
export function memoryStore() {
  return { dir: '/unused', state: { version: 1, instanceId: '550e8400-e29b-41d4-a716-446655440000', owned: {}, pending: null, setup: null, autoConnect: false }, token: null, saves: [], async save() { this.saves.push(structuredClone(this.state)); }, async writeToken(value) { this.token = value; }, async hasToken() { return !!this.token; }, async clearToken() { this.token = null; }, async close() {} };
}
export function fakeCloudflare() {
  const data = { writes: [], apps: [], tunnels: [], records: [], policies: new Map(), configs: new Map(), organization: { auth_domain: SETUP.teamDomain, name: 'Existing organization', mfa_config: { allowed_authenticators: ['biometrics', 'security_key'], session_duration: '8h' }, mfa_required_for_all_apps: false }, fail: null };
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
    if (/\/access\/apps\/[^/]+$/.test(p)) { const id = p.split('/').at(-1), item = data.apps.find(a => a.id === id); if (method === 'DELETE') data.apps = data.apps.filter(a => a.id !== id); return item ? reply(item) : Response.json({ success: false }, { status: 404 }); }
    if (p.endsWith('/cfd_tunnel')) { if (method === 'POST') { const tunnel = { ...body, id: 'tunnel-1', token: 'connector-secret-'.repeat(4) }; data.tunnels.push(tunnel); return reply(tunnel); } return reply(data.tunnels); }
    if (p.endsWith('/configurations')) { const id = p.split('/').at(-2); if (method === 'PUT') data.configs.set(id, body); return reply(data.configs.get(id) || { config: {} }); }
    if (p.endsWith('/token')) return reply('connector-secret-'.repeat(4));
    if (/\/cfd_tunnel\/[^/]+$/.test(p)) { const id = p.split('/').at(-1), item = data.tunnels.find(t => t.id === id); if (method === 'DELETE') data.tunnels = data.tunnels.filter(t => t.id !== id); return item ? reply(item) : Response.json({ success: false }, { status: 404 }); }
    if (p.endsWith('/dns_records')) { if (method === 'POST') { const record = { ...body, id: 'dns-1' }; data.records.push(record); return reply(record); } return reply(data.records); }
    if (/\/dns_records\/[^/]+$/.test(p)) { const id = p.split('/').at(-1), item = data.records.find(t => t.id === id); if (method === 'DELETE') data.records = data.records.filter(t => t.id !== id); return item ? reply(item) : Response.json({ success: false }, { status: 404 }); }
    throw new Error(`Unexpected test request: ${method} ${p}`);
  };
  return { data, fetchImpl };
}
