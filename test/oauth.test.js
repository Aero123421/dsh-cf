import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { OAuth } from '../src/oauth.js';
import { freePort, http } from './helpers.js';
const callback = (flow, state) => `${flow.redirectUri}?code=one-time-code&state=${state ?? new URL(flow.authorizationUrl).searchParams.get('state')}`;
async function begin(t, options = {}) {
  const captured = [], tokens = [];
  const oauth = new OAuth({ fetchImpl: async (url, request) => { captured.push({ url, request }); return Response.json({ access_token: 'management-secret-123456', token_type: 'Bearer', expires_in: 300 }); }, onToken: value => tokens.push(value), ...options });
  t.after(() => oauth.cancel()); const port = await freePort();
  const flow = await oauth.begin({ clientId: 'public-client-12345', scopes: ['registered.scope'], port });
  return { oauth, flow, captured, tokens, port };
}
test('PKCE S256 exchange uses the registered redirect URI and no client secret', async t => {
  const f = await begin(t); assert.equal(new URL(f.flow.authorizationUrl).searchParams.get('code_challenge_method'), 'S256');
  await f.oauth.finish(callback(f.flow)); const form = f.captured[0].request.body;
  assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), new URL(f.flow.authorizationUrl).searchParams.get('code_challenge'));
  assert.equal(form.get('redirect_uri'), f.flow.redirectUri); assert.equal(form.has('client_secret'), false); assert.equal(f.tokens.length, 1);
  await assert.rejects(f.oauth.finish(callback(f.flow)), { code: 'OAUTH_EXPIRED' });
});
test('mismatched state does not consume the valid flow', async t => {
  const f = await begin(t); await assert.rejects(f.oauth.finish(callback(f.flow, 'wrong')), { code: 'OAUTH_STATE' });
  assert.equal(f.captured.length, 0); await f.oauth.finish(callback(f.flow)); assert.equal(f.tokens.length, 1);
});
test('wrong callback destination and duplicate state are rejected', async t => {
  const f = await begin(t); await assert.rejects(f.oauth.finish(callback(f.flow).replace('127.0.0.1', 'evil.example.com')), { code: 'OAUTH_CALLBACK' });
  await assert.rejects(f.oauth.finish(callback(f.flow) + '&state=second'), { code: 'OAUTH_STATE' }); assert.equal(f.captured.length, 0);
});
test('real loopback callback HTTP request completes authorization', async t => {
  const f = await begin(t); const url = new URL(callback(f.flow));
  const res = await http(f.port, { path: url.pathname + url.search, headers: { host: url.host } });
  assert.equal(res.status, 200); assert.equal(f.tokens.length, 1); assert(!res.body.includes('management-secret'));
});
test('callback Host mismatch is rejected before exchange', async t => {
  const f = await begin(t); const url = new URL(callback(f.flow));
  const res = await http(f.port, { path: url.pathname + url.search, headers: { host: 'evil.example.com' } });
  assert.equal(res.status, 400); assert.equal(f.captured.length, 0);
});
test('cancelled flow cannot install a late management token', async t => {
  let resolveFetch; const fetchResult = new Promise(r => { resolveFetch = r; });
  const f = await begin(t, { fetchImpl: () => fetchResult }); const result = f.oauth.finish(callback(f.flow));
  await f.oauth.cancel(); resolveFetch(Response.json({ access_token: 'late-management-secret', token_type: 'Bearer', expires_in: 300 }));
  await assert.rejects(result); assert.equal(f.tokens.length, 0);
});
test('cancel invalidates OAuth initiation before its first await completes', async t => {
  const oauth = new OAuth(); t.after(() => oauth.cancel()); const port = await freePort();
  const starting = oauth.begin({ clientId: 'public-client-12345', scopes: ['registered.scope'], port });
  const rejected = assert.rejects(starting, { code: 'OAUTH_EXPIRED' });
  await oauth.cancel(); await rejected;
  assert.equal(oauth.pending, null); assert.equal(oauth.server, null);
  // The cancelled attempt must not retain the callback port or prevent a legitimate retry.
  const flow = await oauth.begin({ clientId: 'public-client-12345', scopes: ['registered.scope'], port });
  assert.equal(flow.redirectUri, `http://127.0.0.1:${port}/dsh-cf/oauth/callback`);
});
test('cancel during callback listener startup rejects initiation and frees the port', async t => {
  const oauth = new OAuth(); t.after(() => oauth.cancel()); const port = await freePort();
  const starting = oauth.begin({ clientId: 'public-client-12345', scopes: ['registered.scope'], port });
  const rejected = assert.rejects(starting);
  for (let i = 0; !oauth.pending && i < 20; i++) await Promise.resolve();
  assert(oauth.pending, 'the starting listener is registered before listen completion');
  await oauth.cancel(); await rejected;
  assert.equal(oauth.pending, null); assert.equal(oauth.server, null);
  await oauth.begin({ clientId: 'public-client-12345', scopes: ['registered.scope'], port });
});
test('concurrent OAuth starts retain only the newest attempt', async t => {
  const oauth = new OAuth(); t.after(() => oauth.cancel()); const port = await freePort();
  const old = oauth.begin({ clientId: 'public-client-12345', scopes: ['registered.scope'], port });
  const rejected = assert.rejects(old, { code: 'OAUTH_EXPIRED' });
  const flow = await oauth.begin({ clientId: 'new-public-client-123', scopes: ['registered.scope'], port });
  await rejected; assert.equal(oauth.pending.clientId, 'new-public-client-123');
  assert.equal(oauth.pending.redirectUri, flow.redirectUri);
});
test('an older cancelled exchange cannot close a newer callback listener', async t => {
  let resolveFetch; const f = await begin(t, { fetchImpl: () => new Promise(r => { resolveFetch = r; }) });
  const old = f.oauth.finish(callback(f.flow)); await f.oauth.cancel();
  const newer = await f.oauth.begin({ clientId: 'public-client-12345', scopes: ['registered.scope'], port: f.port });
  resolveFetch(Response.json({ access_token: 'old-secret-123456789', token_type: 'Bearer', expires_in: 300 })); await assert.rejects(old);
  assert.equal(f.oauth.pending.redirectUri, newer.redirectUri);
  assert.equal((await http(f.port, { path: '/nonexistent', headers: { host: `127.0.0.1:${f.port}` } })).status, 404);
});
test('revocation identifies the public client that received the grant', async t => {
  const f = await begin(t); await f.oauth.finish(callback(f.flow));
  await f.oauth.revoke('management-secret-123456');
  const revoke = f.captured.at(-1); assert.equal(revoke.url, 'https://dash.cloudflare.com/oauth2/revoke');
  assert.equal(revoke.request.body.get('client_id'), 'public-client-12345'); assert.equal(revoke.request.body.get('token'), 'management-secret-123456');
  assert.equal(revoke.request.body.has('client_secret'), false);
});
test('revocation without a known OAuth client fails locally without a network call', async () => {
  const calls = []; const oauth = new OAuth({ fetchImpl: async (...args) => { calls.push(args); return new Response(null); } });
  await assert.rejects(oauth.revoke('some-token-value-1234567890'), { code: 'OAUTH_REVOKE' }); assert.equal(calls.length, 0);
});
test('offline refresh scopes and missing author Client ID are not silently invented', async () => {
  const oauth = new OAuth();
  await assert.rejects(oauth.begin({ clientId: '', scopes: [] }), { code: 'OAUTH_CLIENT' });
  await assert.rejects(oauth.begin({ clientId: 'public-client-12345', scopes: ['offline_access'] }), { code: 'OAUTH_SCOPES' });
});
test('denial and exchange failure publish a terminal phase and drop the attempt', async t => {
  const states = [];
  const denied = await begin(t, { onState: (status, meta) => states.push({ status, failure: meta.failure }) });
  const state = new URL(denied.flow.authorizationUrl).searchParams.get('state');
  await assert.rejects(denied.oauth.finish(`${denied.flow.redirectUri}?error=access_denied&state=${state}`), { code: 'OAUTH_DENIED' });
  assert.equal(states.at(-1).status, 'denied');
  assert.equal(states.at(-1).failure, 'OAUTH_DENIED');
  assert.equal(denied.oauth.pending, null);
  const failed = await begin(t, { fetchImpl: async () => new Response('no', { status: 400 }), onState: (status, meta) => states.push({ status, failure: meta.failure }) });
  await assert.rejects(failed.oauth.finish(callback(failed.flow)), { code: 'OAUTH_EXCHANGE' });
  assert.equal(states.at(-1).status, 'error');
  assert.equal(states.at(-1).failure, 'OAUTH_EXCHANGE');
  assert.equal(failed.oauth.pending, null);
});
test('the attempt timer publishes expired once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const states = [];
  const oauth = new OAuth({ onState: status => states.push(status) });
  t.after(() => oauth.cancel());
  const port = await freePort();
  await oauth.begin({ clientId: 'public-client-12345', scopes: ['registered.scope'], port });
  assert.equal(states.at(-1), 'waiting');
  t.mock.timers.tick(5 * 60_000);
  for (let i = 0; states.at(-1) !== 'expired' && i < 50; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(states.at(-1), 'expired');
  assert.equal(oauth.pending, null);
});
test('a late exchange failure does not overwrite a newer attempt', async t => {
  let rejectFetch;
  const states = [];
  const oauth = new OAuth({
    onState: (status, meta) => states.push({ status, attempt: meta.attempt }),
    fetchImpl: () => new Promise((_resolve, reject) => { rejectFetch = reject; }),
  });
  t.after(() => oauth.cancel());
  const port = await freePort();
  const old = await oauth.begin({ clientId: 'public-client-12345', scopes: ['registered.scope'], port });
  const finishing = oauth.finish(callback(old));
  await oauth.cancel();
  const newer = await oauth.begin({ clientId: 'public-client-12345', scopes: ['registered.scope'], port });
  rejectFetch(Object.assign(new Error('late'), { code: 'OAUTH_EXCHANGE' }));
  await assert.rejects(finishing);
  assert.equal(states.filter(item => item.status === 'error').length, 0);
  assert.equal(oauth.pending.attempt, newer.attempt);
  assert.equal(states.at(-1).status, 'waiting');
  assert.equal(states.at(-1).attempt, newer.attempt);
});
