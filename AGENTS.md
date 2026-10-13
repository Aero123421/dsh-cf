# dsh-cf development

Keep this a small DSH bundle plugin. Do not introduce a Worker, database, compatibility layer, migration framework, system cloudflared service, or unrelated framework without an explicit requirement.

Use the official DSH Connection/WebServer/configEditor APIs. Root controller lifetime must not depend on Connection: updating trustedHosts normally reloads it. Do not monkey-patch DSH internals, rewrite remote Host to loopback, remove Origin, read DSH signing keys, or disable existing authentication.

Default deny. Tests must cover real loopback HTTP/WS boundaries, cancellation, ownership, persistence and non-replay of writes. `npm ci && npm run check` is the release check. `DSH_CF_OFFLINE_TEST=1 npm run check` is a deliberately weaker disconnected development check, not evidence that JWT verification passed.

Every UI checkmark must derive from host state or observed evidence, never a timer. Keep browser secrets out of storage, logs, status snapshots and public URLs. Respect reduced motion. Do not leak raw Cloudflare or connector errors.

Do not create CI, deployed services, cloud resources, or paid plans as a side effect of editing the code. Live testing requires a deliberately selected test account/hostname and explicit credentials supplied for that purpose. Never overwrite unrelated resource IDs or adopt a tunnel by display name.

Keep README and SECURITY honest about which actual environments and dependencies were tested. Implement only current supported contracts; do not silently weaken enforcement when an API changes.
