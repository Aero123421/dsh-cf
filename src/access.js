import { demand, issuer, email } from './common.js';

/** JWT issuers and JWKS URLs are pinned configuration, never token-controlled URLs. */
export async function accessVerifier({ teamDomain, audience, ownerEmail }, options = {}) {
  const expectedIssuer = issuer(teamDomain); const owner = email(ownerEmail);
  demand(typeof audience === 'string' && /^[a-f0-9]{64}$/i.test(audience), 'AUDIENCE', 'The Access application audience is missing or invalid.');
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const keys = options.keySet ?? createRemoteJWKSet(new URL(`${expectedIssuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 });
  return async token => {
    demand(typeof token === 'string' && token.length <= 16_384, 'AUTH', 'Authentication required.');
    const { payload } = await jwtVerify(token, keys, { issuer: expectedIssuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email', 'type'], clockTolerance: 0 });
    demand(payload.type === 'app' && typeof payload.sub === 'string' && payload.sub.length > 0 && typeof payload.email === 'string' && payload.email.toLowerCase() === owner, 'AUTH', 'Owner authentication required.');
    demand(Number.isSafeInteger(payload.exp) && Number.isSafeInteger(payload.iat) && payload.iat <= Date.now() / 1000 + 30 && payload.exp > payload.iat, 'AUTH', 'Invalid authentication lifetime.');
    return { subject: payload.sub, email: owner, expiresAt: payload.exp * 1000 };
  };
}
