/** Non-mutating external rejection probe. Never sends a Cloudflare management token. */
const [root, teamDomain] = process.argv.slice(2);
if (!root || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain || '')) {
  console.error('Usage: npm run test:live -- https://dsh.example.com/ team.cloudflareaccess.com'); process.exit(2);
}
const url = new URL(root);
if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Supply a clean HTTPS root URL.');
const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) }); await response.body?.cancel();
const location = response.headers.get('location'); const destination = location ? new URL(location, url) : null;
if (![302, 303, 307, 308].includes(response.status) || destination?.hostname !== teamDomain || destination.protocol !== 'https:' || !destination.pathname.startsWith('/cdn-cgi/access/')) {
  console.error(`Rejection NOT verified (HTTP ${response.status}). This probe does not treat arbitrary error/login pages as success.`); process.exit(1);
}
console.log('Unauthenticated Access redirect verified. Complete WebAuthn, DSH API, and WebSocket checks in the plugin panel; this probe does not test them.');
