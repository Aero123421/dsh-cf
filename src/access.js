import { CfError, demand, issuer, email } from './common.js';

const CLOCK_SKEW_SECONDS = 30;
/** After a failed key refresh, the last good key set stays usable this long. It never covers a key id that was not in it. */
export const JWKS_FALLBACK_MS = 24 * 60 * 60_000;
// jose reports an unreachable or unusable key endpoint with these codes; a fetch that rejects has no code or a network one.
const KEY_ENDPOINT_CODES = new Set(['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JOSE_GENERIC']);
const keyEndpointFailure = error => !(error instanceof CfError) && (KEY_ENDPOINT_CODES.has(error?.code) || ((error?.name === 'TypeError' || error?.name === 'AbortError' || error?.name === 'TimeoutError') && !String(error?.code ?? '').startsWith('ERR_J')));

/**
 * JWT issuers and JWKS URLs are pinned configuration, never token-controlled URLs.
 * A failure to reach the key endpoint is reported as AUTH_UNAVAILABLE, which is a problem on this PC and not a bad sign-in.
 * @param options.keySet - key resolver for tests: `(header, token) => key`, optionally with `.jwks()`.
 * @param options.now - clock for the fallback window.
 */
export async function accessVerifier({ teamDomain, audience, ownerEmail }, options = {}) {
  const expectedIssuer = issuer(teamDomain); const owner = email(ownerEmail);
  demand(typeof audience === 'string' && /^[a-f0-9]{64}$/i.test(audience), 'AUDIENCE', 'The Access application audience is missing or invalid.');
  const { createRemoteJWKSet, createLocalJWKSet, jwtVerify } = await import('jose');
  const now = options.now ?? Date.now;
  const remote = options.keySet ?? createRemoteJWKSet(new URL(`${expectedIssuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 });
  let good = null; // { jwks, at }: the key set behind the most recent successful lookup
  const keys = async (header, token) => {
    try {
      const key = await remote(header, token);
      const jwks = remote.jwks?.(); if (jwks) good = { jwks, at: now() };
      return key;
    } catch (error) {
      if (!keyEndpointFailure(error)) throw error;
      if (good && now() - good.at <= JWKS_FALLBACK_MS) {
        try { return await createLocalJWKSet(good.jwks)(header, token); }
        catch { /* a key id that was never seen cannot be checked: report the outage */ }
      }
      throw new CfError('AUTH_UNAVAILABLE', 'This PC could not reach Cloudflare to fetch the sign-in verification keys.');
    }
  };
  return async token => {
    demand(typeof token === 'string' && token.length <= 16_384, 'AUTH', 'Authentication required.');
    // Access sets nbf = iat. Tolerate a host clock up to 30 s behind Cloudflare for nbf/iat only;
    // expiry is enforced strictly below, so the tolerance never extends a session.
    const { payload } = await jwtVerify(token, keys, { issuer: expectedIssuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email', 'type'], clockTolerance: CLOCK_SKEW_SECONDS });
    demand(payload.type === 'app' && typeof payload.sub === 'string' && payload.sub.length > 0 && typeof payload.email === 'string', 'AUTH', 'Authentication required.');
    demand(payload.email.toLowerCase() === owner, 'AUTH_OWNER', 'This account is not allowed.');
    const current = Date.now() / 1000;
    demand(Number.isSafeInteger(payload.exp) && Number.isSafeInteger(payload.iat) && payload.iat <= current + CLOCK_SKEW_SECONDS && payload.exp > payload.iat && payload.exp > current, 'AUTH', 'Invalid authentication lifetime.');
    return { subject: payload.sub, email: owner, expiresAt: payload.exp * 1000 };
  };
}
