import { createHash, randomBytes } from 'node:crypto';

export class CfError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'CfError'; this.code = code; this.details = details; }
}
export function demand(ok, code, message) { if (!ok) throw new CfError(code, message); }
export const nonce = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');
export const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(finish, ms);
  const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
  signal?.addEventListener('abort', abort, { once: true });
});
export function hostname(value) {
  demand(typeof value === 'string' && value.length <= 253 && value === value.trim(), 'HOSTNAME', 'Enter a bare DNS hostname, without a URL, port, or path.');
  const host = value.toLowerCase();
  demand(host.includes('.') && host.split('.').every(p => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p)) && !/^\d+(?:\.\d+){3}$/.test(host), 'HOSTNAME', 'Use a valid ASCII DNS hostname (punycode for international names).');
  return host;
}
export function email(value) {
  demand(typeof value === 'string' && value.length <= 254 && /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(value), 'OWNER', 'One explicit owner email is required. Empty never means everyone.');
  return value.toLowerCase();
}
export function cfId(value) {
  demand(typeof value === 'string' && /^[a-f0-9]{32}$/.test(value), 'ID', 'Select a valid Cloudflare account and zone.');
  return value;
}
export function issuer(value) {
  demand(typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(value), 'ISSUER', 'A Cloudflare Access team domain is required.');
  return `https://${value}`;
}
export function safeError(error) {
  // Do not serialize arbitrary remote responses, cookies, argv, or request URLs.
  if (error instanceof CfError) return { code: error.code, message: error.message, details: error.details };
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return { code: error.name, message: 'The operation was cancelled or timed out. Retry from the settings panel.' };
  return { code: 'INTERNAL', message: 'The operation failed. Check connectivity, file permissions, and the configured runtime. No authentication bypass was enabled.' };
}
export function timeout(signal, milliseconds = 30_000) {
  return AbortSignal.any([AbortSignal.timeout(milliseconds), ...(signal ? [signal] : [])]);
}
export async function boundedJson(response, maximum = 2 * 1024 * 1024) {
  demand(response.body, 'RESPONSE', 'The remote service returned an empty response.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; demand(size <= maximum, 'RESPONSE_SIZE', 'The remote response exceeded its safety limit.'); chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new CfError('RESPONSE', 'The remote service did not return valid JSON.'); }
  } finally { await reader.cancel().catch(() => {}); }
}
export function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
