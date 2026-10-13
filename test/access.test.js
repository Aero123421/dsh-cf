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
