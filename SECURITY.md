# Security model

This is an unaudited alpha plugin for a **single trusted DSH operator**. DSH can execute programs and access the host's files. Granting access is effectively granting operator control, not a read-only chat account.

## Trust boundaries

The browser trusts Cloudflare TLS, Access, its configured identity provider and MFA policy. Cloudflare terminates public TLS and can inspect or modify web traffic: **this is not end-to-end encryption against Cloudflare**. The local proxy verifies an RS256 app JWT against a pinned team issuer/JWKS URL, exact application audience, required claims, expiration, and one owner email. It never trusts an email header by itself.

Cloudflare's API account and zone are explicitly selected. Provisioning refuses preexisting DNS records, overlapping Access apps, unexpected policy changes, and unknown POST outcomes. A separate per-instance tunnel is used, not a replica of an unrelated machine. Configuration contains no paid-service activation calls.

The proxy preserves public Host and same-origin browser checks. DSH's own launch-token exchange runs only over its loopback listener. Its signed cookie is kept in server memory and stripped from public response headers. The DSH signing secret is never accessed. DSH private implementation objects are not patched.

## Administrative and runtime credentials

OAuth uses S256 PKCE, an unpredictable state, an exact registered callback, five-minute initiation expiry, and single-use exchange. A cancelled/older attempt cannot install a late grant or close a newer listener. Headless callback recovery must use the already trusted original DSH connection. Client secrets and persistent refresh grants are not used.

Cloudflare management grants are memory-only. The dedicated Tunnel token is stored as a restricted file; it is **not encrypted with an OS keychain**. No secrets are returned by the status API, put in public DSH URLs, printed by logging code, or passed as command-line argument values. The child connector receives an allowlisted environment rather than model/API credentials.

Original authenticated DSH callers can manage the plugin. The public gate permits only the sanitized `/dsh-cf/status` endpoint from its management channel; all mutations in that channel are blocked, including encoded aliases. This is not a separate privilege boundary against DSH's own operator capabilities: an authenticated DSH operator can run commands and change files. Do not assume the plugin protects the Cloudflare token from other plugins or malicious code executed by that same OS user.

## Streams, cookies, and revocation

Every new HTTP/WS request is checked. State-changing HTTP and WS requests require the exact browser Origin. Cross-site GET navigation is allowed only at safe entry/verification documents. Incoming cookies/Authorization/forwarded metadata are not used as DSH credentials. The upstream signed cookie is injected after JWT validation.

Uploads are bounded to 100 MiB, header bytes and concurrency are bounded, streams are forwarded with backpressure. WS/SSE/HTTP streams close on the earlier of JWT expiration or 15 minutes. The plugin does not replay writes after an upstream failure. Stop closes existing sockets and the owned connector. A guardian notices parent IPC loss and terminates its own child after a DSH crash.

A locally valid JWT does **not** prove the current Cloudflare policy has not just changed. Independent MFA is enforced by Cloudflare; the gate does not receive a cryptographic WebAuthn attestation from the browser. API settings are checked during provisioning, not continuously on every request or offline resume. Edge logout/revocation may not instantly end an established stream. For immediate local revocation, stop this plugin; then revoke Cloudflare sessions/tokens and rotate credentials as needed. An existing local DSH session has separate lifetime and ownership.

## Supply chain and files

The bundled source executes no install/prepare hook. The only application dependency is the pinned `jose` package. The lock points to its immutable official v6.2.12 release tarball and published SHA-256. Audit the dependency and verify `npm ci && npm run check` in a connected environment before release.

cloudflared private downloads use a pinned release version and official release digest, checked before extraction/execution. This trusts Cloudflare's GitHub release account/API and GitHub TLS. It is not independent signature verification. Its executable cache is checked before reuse. Explicit user-selected or previously installed binaries remain the user's trust decision. Existing services, configuration files and other tunnels are not reconfigured.

State/token files are scoped to the active profile, written atomically with POSIX mode 0600 under a 0700 directory. Windows ACLs require environment review. Root/admin access, filesystem snapshots, backups, the same OS user, malicious extensions, and a compromised DSH/runtime can expose these files or process memory. Keep state and token files out of git and shared folders.

## Profile ownership and copied state

`owner.lock` keeps two DSH processes from running one profile's connector. It is a lease: the owner refreshes its mtime every few seconds. PID presence, equality, or absence proves nothing across PID namespaces such as two containers sharing a volume. Every existing lock is observed for longer than one heartbeat interval and reclaimed only if its heartbeat has stopped; a heartbeating lock is refused. Renewal checks the nonce on the opened lock file, so it never refreshes a replacement owner's inode. Detected ownership loss stops this instance's gate and connector and blocks further state/token writes. The heartbeat assumes a filesystem that updates mtimes, which shared network filesystems may not do reliably, and does not provide atomic distributed transactions. State records a host identity (platform, hostname, home directory). When it differs, the plugin still loads but turns auto-connect off and refuses to connect until the local operator confirms that no other DSH uses the same Tunnel; confirmed identities are remembered. This is an operator safeguard against accidentally running a copied profile twice, not a cryptographic device binding.

## Settings channel

The `/dsh-cf/<action>` channel is registered on DSH's WebServer route table and admits each request with DSH Connection's own Host/Origin/cookie fence (`connection.requestRejection()`), using the same JSON envelope as DSH RPC. `connection.rpc.handle()` is not used because in DSH 0.2.1-alpha.2 it throws for plugin contexts. Over the public hostname the gate additionally allows only the read-only `status` action.

## Live validation status

Plugin version `0.1.0-alpha.2` was validated on real DSH `0.2.1-alpha.2` (npm, Linux, web profile), with Cloudflare's edge emulated by a local TLS proxy and Access JWTs signed by a local RSA key: plugin install and load, settings UI and channel admission, `trustedHosts` persistence through configEditor and the resulting Connection reload, launch-token cookie exchange, HTTP/API/WebSocket proxying, rejection of missing/wrong-owner/expired JWTs and of public management, launch tokens and cross-origin requests, automatic UI reconnection after forced stream closure, boot-time auto-connect launching the real cloudflared 2026.10.0 with its exact flags, connector and guardian cleanup after `kill -9` of DSH, stale-lock recovery, and the host-identity review. The real JOSE RSA/JWT tests run in `npm run check`.

Version `0.1.0-alpha.3` adds local regression coverage for overlapping shutdown, authorization replacement, management-operation cancellation, rejected WebSocket cleanup, per-connection Tunnel status, and configuration readback. These local fixtures do not establish live Cloudflare compatibility; the release remains a developer preview.

`@deepseek-ai/dsh` is declared as `>=0.2.1-alpha.2 <0.3.0-0`. DSH `0.2.1-alpha.2` and `0.2.1-alpha.3` both accept a peer when `semver.satisfies(runtime, range, { includePrerelease: true })` is true, so this range is intended to load on those versions and on later `0.2.x` prereleases. The live install and proxy checks above were run on `0.2.1-alpha.2` only. `0.2.1-alpha.3` was checked from the published app-boot compatibility function and the plugin-manager install contract, not by loading this plugin in that host.

Still required before release:

- Confirm OAuth registration accepts the intended loopback callback and granted scopes, including headless setup.
- Confirm the current Cloudflare API accepts and read-backs organization/app/policy independent MFA fields exactly as implemented; verify no IdP shortcut weakens the intended WebAuthn requirement.
- With a real Access application: normal owner login with WebAuthn, incorrect user, expiry, key rotation, logout, revoked sessions, and Tunnel registration through the edge.
- Desktop's dynamic port, Electron child processes, and coexistence with another installed Tunnel on macOS and Windows.
- Exercise iPadOS/Safari and credential recovery. Use at least a second registered authenticator/appropriate IdP recovery, managed in Access.

Do not add bypasses to work around a failed integration test. Leave publication stopped, report the failing boundary, and fix the integration.

## Reporting

Do not publish live tokens, callback URLs, cookies, private files, or exploitable proof against deployed installations in a public issue. Prefer GitHub private vulnerability reporting if enabled; otherwise ask the maintainer for a private reporting channel without including exploit details. No formal audit or response SLA is claimed.

## プラグインの更新経路

更新確認・導入・結果照合はDSHの認証に加え、元のloopback接続・Host・Originを確認し、転送元headerのある要求を拒否します。公開gateは従来どおり`/dsh-cf/status`だけを読み取り用として許可し、更新操作を転送しません。

候補は固定GitHub repositoryの明示したリリースタグだけです。画面から任意URLやshell文字列を受け取らず、build scriptを自動承認しません。更新記録には操作ID・版・結果だけを保存し、Cloudflare tokenやDSHの認証情報を含めません。
