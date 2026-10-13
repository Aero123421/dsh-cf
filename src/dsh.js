import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { CfError, demand, digest } from './common.js';

// Node can bind localhost to either family. Never resolve a launch-token request off loopback.
function loopbackLookup(_host, options, callback) {
  const addresses = [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }].filter(a => !options.family || a.family === options.family);
  if (options.all) callback(null, addresses);
  else callback(null, addresses[0].address, addresses[0].family);
}

/** Use only supported DSH seams; never read its signing secret or mutate internal services. */
export class DshAdapter {
  constructor(ctx, config = {}) { this.ctx = ctx; this.config = config; this.cached = null; this.loading = null; }
  facts() {
    const web = this.ctx.get('webServer'); const connection = this.ctx.get('connection');
    demand(web && connection && typeof connection.authenticatedUrl === 'function' && typeof connection.requestRejection === 'function', 'DSH_API', 'This DSH build does not expose the required Web/Connection APIs.');
    demand(['127.0.0.1', 'localhost', '::1'].includes(web.host), 'DSH_BIND', 'Bind DSH to loopback before enabling remote access.');
    demand(Number.isInteger(web.port) && web.port > 0, 'DSH_PORT', 'DSH has not opened its Web listener yet.');
    return { port: web.port, protocol: web.protocol, address: web.host, connection };
  }
  async trust(host) {
    const editor = this.ctx.get('configEditor');
    demand(editor?.entries && editor?.edit, 'DSH_CONFIG', 'The official DSH configEditor service is required.');
    const entry = editor.entries().find(e => e.options.name === '@deepseek-ai/dsh-client-connection');
    demand(entry, 'DSH_CONFIG', 'The active Connection configuration is not editable through this profile.');
    if (this.facts().connection.requestRejection({ headers: { host } }) !== 403) return;
    try {
      await editor.edit(entry, current => {
        const raw = current.trustedHosts;
        let trustedHosts;
        if (raw === undefined) trustedHosts = [host];
        else if (Array.isArray(raw) && raw.every(x => typeof x === 'string')) trustedHosts = [...new Set([...raw, host])];
        else if (typeof raw?.__jsExpr === 'string') trustedHosts = { __jsExpr: `[...new Set([...(${raw.__jsExpr}), ${JSON.stringify(host)}])]` };
        else throw new CfError('DSH_CONFIG', 'Unrecognized trustedHosts configuration. It was not overwritten.');
        return { ...current, trustedHosts };
      });
    } catch (e) {
      if (e instanceof CfError) throw e;
      // configEditor refuses to persist when a home patch or --patch overlay overrides the Connection row.
      throw new CfError('DSH_CONFIG', /overridden/i.test(String(e?.message))
        ? 'DSH could not save the public hostname because a home patch or --patch overlay overrides the Connection settings. Start DSH with --trusted-host for this hostname, or add it to that overlay.'
        : 'DSH did not accept the trustedHosts change. Nothing else was modified; check the profile configuration and retry.');
    }
    demand(this.facts().connection.requestRejection({ headers: { host } }) === 401, 'DSH_TRUST', 'DSH did not activate the public hostname. Restart DSH and retry.');
    this.invalidate();
  }
  invalidate() { this.cached = null; }
  async target(publicHost) {
    const facts = this.facts(); const secure = facts.protocol === 'https:';
    demand(facts.protocol === 'http:' || secure, 'DSH_TLS', 'Unsupported DSH listener protocol.');
    const ca = this.config.originCaFile ? await readFile(this.config.originCaFile) : undefined;
    return { hostname: facts.address, port: facts.port, protocol: facts.protocol, ...(facts.address === 'localhost' ? { lookup: loopbackLookup, autoSelectFamily: true } : {}), ...(secure ? { servername: this.config.originServerName || publicHost, ...(ca ? { ca } : {}), rejectUnauthorized: true } : {}) };
  }
  async cookie(publicHost) {
    const facts = this.facts(); const target = await this.target(publicHost);
    // Tokens never leave loopback. Hash only to detect Connection/DSH reloads.
    const authUrl = new URL(facts.connection.authenticatedUrl(`https://${publicHost}/`));
    const key = digest(`${facts.protocol}:${facts.port}:${publicHost}:${authUrl.search}`);
    if (this.cached?.key === key && this.cached.until > Date.now()) return this.cached.value;
    if (this.loading?.key === key) return this.loading.promise;
    const promise = new Promise((resolve, reject) => {
      const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = transport({ ...target, method: 'GET', path: `/${authUrl.search}`, headers: { host: publicHost }, timeout: 5000 }, res => {
        res.resume();
        if (res.statusCode !== 303 || res.headers.location !== './') return reject(new CfError('DSH_AUTH', 'DSH did not complete its normal session exchange.'));
        const cookies = (res.headers['set-cookie'] ?? []).filter(c => /^dsh-auth-[A-Za-z0-9_-]+=/.test(c));
        if (cookies.length !== 1) return reject(new CfError('DSH_AUTH', 'DSH returned an unexpected session cookie.'));
        const value = cookies[0].split(';', 1)[0];
        this.cached = { key, value, until: Date.now() + 5 * 60_000 }; resolve(value);
      });
      req.once('timeout', () => req.destroy(new CfError('DSH_TIMEOUT', 'DSH session exchange timed out.')));
      req.once('error', () => reject(new CfError('DSH_CONNECTION', 'Could not reach DSH securely on its loopback listener. Check its TLS configuration.'))); req.end();
    });
    const item = { key, promise }; this.loading = item;
    try { return await promise; } finally { if (this.loading === item) this.loading = null; }
  }
}
