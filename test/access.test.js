import test from 'node:test';
import assert from 'node:assert/strict';
import { accessVerifier } from '../src/access.js';
import { SETUP, AUD } from './helpers.js';
let jose;
try { jose = await import('jose'); }
catch (e) { if (process.env.DSH_CF_OFFLINE_TEST !== '1' || e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
test('real JOSE RSA verification rejects forged, wrong-owner, wrong-audience and expired tokens', { skip: !jose ? 'Explicit offline run: jose package unavailable; npm ci && npm test is required before release' : false }, async () => {
  const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
  const jwk = await jose.exportJWK(publicKey); jwk.kid = 'test-key'; jwk.alg = 'RS256';
  const verify = await accessVerifier({ ...SETUP, audience: AUD }, { keySet: jose.createLocalJWKSet({ keys: [jwk] }) });
  const now = Math.floor(Date.now() / 1000);
  const sign = changes => new jose.SignJWT({ iss: `https://${SETUP.teamDomain}`, aud: AUD, sub: 'owner-id', type: 'app', email: SETUP.ownerEmail, iat: now - 1, exp: now + 60, ...changes }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(privateKey);
  assert.equal((await verify(await sign({}))).email, SETUP.ownerEmail);
  for (const fields of [{ aud: 'd'.repeat(64) }, { iss: 'https://attacker.example' }, { email: 'attacker@example.com' }, { exp: now - 2 }, { type: 'service' }, { iat: now + 3600, exp: now + 7200 }]) await assert.rejects(verify(await sign(fields)));
  const signed = await sign({}); const pieces = signed.split('.'); pieces[1] = Buffer.from(JSON.stringify({ email: SETUP.ownerEmail, exp: now + 1000 })).toString('base64url');
  await assert.rejects(verify(pieces.join('.'))); await assert.rejects(verify('x'.repeat(17000)));
});
test('a host clock slightly behind Cloudflare accepts fresh tokens, but expiry is never extended', { skip: !jose ? 'Explicit offline run: jose package unavailable' : false }, async () => {
  const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
  const jwk = await jose.exportJWK(publicKey); jwk.kid = 'k'; jwk.alg = 'RS256';
  const verify = await accessVerifier({ ...SETUP, audience: AUD }, { keySet: jose.createLocalJWKSet({ keys: [jwk] }) });
  const now = Math.floor(Date.now() / 1000);
  const sign = claims => new jose.SignJWT({ iss: `https://${SETUP.teamDomain}`, aud: AUD, sub: 'owner-id', type: 'app', email: SETUP.ownerEmail, ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'k' }).sign(privateKey);
  // Cloudflare issued this token 10 s "in the future" relative to a lagging host clock (Access sets nbf = iat).
  assert.equal((await verify(await sign({ iat: now + 10, nbf: now + 10, exp: now + 3600 }))).email, SETUP.ownerEmail);
  await assert.rejects(verify(await sign({ iat: now + 120, nbf: now + 120, exp: now + 3600 })));
  for (const exp of [now - 1, now - 20]) await assert.rejects(verify(await sign({ iat: now - 3600, nbf: now - 3600, exp })), { code: 'AUTH' });
});
