/** Keyless release smoke: packed plugin, real published DSH, official config edit, HTTP and WS. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import * as jose from 'jose';
import { DshAdapter } from '../src/dsh.js';
import { Gate } from '../src/gate.js';
import { accessVerifier } from '../src/access.js';
import semver from 'semver';
import manifest from '../package.json' with { type: 'json' };

const VERSION = manifest.version;

const source = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), 'dsh-cf-smoke-'));
const selector = process.env.DSH_CF_DSH_VERSION || 'next';
assert(/^(?:alpha|next|\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/.test(selector), 'invalid DSH selector');
const scrub = text => text.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]');
async function command(bin, args, cwd = directory, env = process.env) {
  const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 240_000);
  try { const [code] = await once(child, 'exit'); assert.equal(code, 0, scrub(output).slice(-3000)); return output; }
  finally { clearTimeout(timer); }
}
function http(port, { path = '/', method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.setTimeout(15_000, () => req.destroy(new Error('HTTP smoke timed out')));
    req.on('error', reject); req.end(body);
  });
}
let child, gate, socket;
try {
  try { await command('pnpm', ['--version']); }
  catch { throw new Error('DSH plugin installation needs pnpm on PATH. Install it with npm install -g pnpm@11.25.0 before this smoke.'); }
  const runtime = process.env.DSH_CF_DSH_ROOT ? resolve(process.env.DSH_CF_DSH_ROOT) : join(directory, 'runtime');
  if (!process.env.DSH_CF_DSH_ROOT) await command('npm', ['install', '--prefix', runtime, '--ignore-scripts', '--no-audit', '--no-fund', `@deepseek-ai/dsh@${selector}`]);
  const runtimeVersion = JSON.parse(await readFile(join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version;
  assert(semver.satisfies(runtimeVersion, manifest.peerDependencies['@deepseek-ai/dsh'], { includePrerelease: true }), `review DSH ${runtimeVersion} before extending support`);
  const bin = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
  const pack = JSON.parse(await command('npm', ['pack', '--json', '--pack-destination', directory], source));
  const home = join(directory, 'home'), env = { ...process.env, DSH_HOME: home };
  const companion = join(directory, 'probe'); await mkdir(companion);
  await writeFile(join(companion, 'package.json'), JSON.stringify({ name: 'dsh-cf-smoke', version: '1.0.0', type: 'module', main: 'index.mjs', dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  await writeFile(join(companion, 'cordis.patch.yml'), '- insert:\n    - id: dsh-cf-smoke\n      name: dsh-cf-smoke\n');
  await writeFile(join(companion, 'index.mjs'), `
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const inject = ['profileContext'];
export function apply(ctx) {
  ctx.inject(['connection', 'webServer', 'configEditor'], child => {
    child.effect(() => child.webServer.register({ kind: 'prefix', path: '/review-trust', handler: async (req, res) => {
      const rejection = child.connection.requestRejection(req);
      if (rejection !== undefined) { res.writeHead(rejection); res.end(); return; }
      try {
        const require = createRequire(join(ctx.profileContext.dir, 'package.json'));
        const { DshAdapter } = await import(pathToFileURL(join(dirname(require.resolve('dsh-cf')), 'dsh.js')));
        await new DshAdapter(ctx).trust('dsh.review.invalid');
        res.writeHead(200); res.end('trusted');
      } catch { res.writeHead(500); res.end('trust failed'); }
    } }), 'review trust probe');
  });
}`);
  const spec = process.env.DSH_CF_PLUGIN_SPEC || join(directory, pack[0].filename);
  await command(process.execPath, [bin, 'plugin', '--profile', 'web', 'add', '-w', spec, companion], directory, env);
  child = spawn(process.execPath, [bin, 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 60_000;
  while (!/dsh web: http\S+/.test(output)) {
    assert(child.exitCode === null && child.signalCode === null && Date.now() < deadline, scrub(output).slice(-2000) || 'DSH did not open a listener');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const launch = new URL(output.match(/dsh web: (http\S+)/)[1]); const port = Number(launch.port);
  assert.equal((await http(port)).status, 401);
  const login = await http(port, { path: '/' + launch.search }); assert.equal(login.status, 303);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  assert.equal((await http(port, { path: '/review-trust', headers: { cookie } })).status, 200);
  const patch = await readFile(join(home, 'profiles/web/cordis.patch.yml'), 'utf8'); assert(patch.includes('dsh.review.invalid'));
  const adapter = new DshAdapter({ get: name => name === 'webServer' ? { host: '127.0.0.1', port, protocol: 'http:' } : name === 'connection' ? { authenticatedUrl(base) { const url = new URL(base); url.search = launch.search; return url.href; }, requestRejection() { return 401; } } : undefined });
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256'); const jwk = await jose.exportJWK(publicKey); jwk.kid = 'smoke';
  const setup = { teamDomain: 'review.cloudflareaccess.com', audience: 'c'.repeat(64), ownerEmail: 'owner@example.com' };
  const verify = await accessVerifier(setup, { keySet: jose.createLocalJWKSet({ keys: [jwk] }) });
  const sign = email => new jose.SignJWT({ email, type: 'app' }).setProtectedHeader({ alg: 'RS256', kid: 'smoke' }).setIssuer(`https://${setup.teamDomain}`).setAudience(setup.audience).setSubject('review').setIssuedAt().setExpirationTime('60s').sign(privateKey);
  gate = new Gate({ host: 'dsh.review.invalid', instanceId: 'smoke', adapter, verify }); await gate.start();
  const headers = { host: gate.host, origin: `https://${gate.host}`, 'cf-access-jwt-assertion': await sign(setup.ownerEmail), 'content-type': 'application/json' };
  assert.equal((await http(gate.port, { headers: { host: gate.host } })).status, 401);
  assert.equal((await http(gate.port, { headers: { ...headers, 'cf-access-jwt-assertion': await sign('other@example.com') } })).status, 401);
  const index = await http(gate.port, { headers }); assert.equal(index.status, 200); assert.equal(index.headers['set-cookie'], undefined);
  const rpc = await http(gate.port, { path: '/dsh-cf/status', method: 'POST', headers, body: JSON.stringify({ type: 'client-request', rpcId: 'smoke', method: 'status', payload: {} }) });
  const status = JSON.parse(rpc.body); assert.equal(status.result.ok, true); assert.equal(status.result.value.version, VERSION); assert(status.result.value.generation);
  assert.equal((await http(gate.port, { path: '/dsh-cf/stop', method: 'POST', headers, body: '{}' })).status, 403);
  assert.equal((await http(gate.port, { path: '/dsh-cf/pending/inspect', method: 'POST', headers, body: '{}' })).status, 403);
  await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: gate.port, path: '/api/remote.mux', headers: { ...headers, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' } });
    req.setTimeout(15_000, () => req.destroy(new Error('WS smoke timed out'))); req.on('error', reject);
    req.on('response', res => { res.resume(); reject(new Error(`WS upgrade returned ${res.statusCode}`)); });
    req.on('upgrade', (res, stream) => { socket = stream; stream.on('error', () => {}); assert.equal(res.statusCode, 101); resolve(); }); req.end();
  });
  console.log(`DSH ${runtimeVersion}: packed dsh-cf ${VERSION}, official trustedHosts persistence/reload, launch exchange, HTTP/RPC/WS, JWT and management rejection passed (local RSA fixture; no Cloudflare resources).`);
} finally {
  socket?.destroy(); await gate?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  await rm(directory, { recursive: true, force: true });
}
