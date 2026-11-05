# Access and security

PantryPal has no accounts. A shared password can protect the browser; bearer
tokens protect API and MCP clients. Both grant full household access.

## Access rules

| Path | Required access |
| --- | --- |
| Web app, static files | Public |
| `/health`, `/openapi.json`, `/auth/session` | Public |
| `/auth/login`, `/auth/logout` | Public, same-origin; password mode only |
| `/api/v1/*` | Bearer, session cookie, or network trust |
| `/mcp` | Bearer token, always |

## Authentication precedence

1. A sent `Authorization` header must be a valid bearer token; an invalid token
   returns `401`, even with a valid session cookie.
2. In password mode, a valid session cookie authenticates `/api/v1`; unsafe
   methods also need a same-origin request.
3. Without a password, `PANTRYPAL_TRUST_NETWORK=1` lets headerless requests act
   as the household; tokens are still checked.
4. Otherwise the request returns `401`.

Password mode overrides network trust. `/mcp` never accepts a cookie or trust. A
session with no household returns `503` (`unavailable`); create one with
`household init`.

## Password login

Set a long random `PANTRYPAL_PASSWORD`. On a public instance, also set
`PANTRYPAL_REQUIRE_PASSWORD=1` so startup fails when the password is missing.
One password serves the household; no usernames. The signed session cookie lasts
30 days. Changing the password and restarting invalidates every session; tokens
are unaffected. Logout clears the current browser's cookie, but a copied cookie
stays valid until it expires or the password rotates. The cookie is `HttpOnly`,
`Secure`, and `SameSite=Lax`; use HTTPS outside `http://localhost`. Login origin
and throttle rules are in the
[REST API reference](../reference/rest-api.md#browser-session-endpoints).

For public access, use [Cloudflare Tunnel](tunnel.md). Do not put Cloudflare
Access in front of it; that would block MCP bearer tokens.

## Network trust

Use trust only on a private network. Anyone who can reach the port can read and
change data. The default Compose override enables trust and binds to loopback;
keep those settings together. Other containers on `rakazo_app` can still reach the
service. The base Compose file alone disables trust, so only bearer clients work.

For remote private access, use a VPN or tailnet (for Tailscale:
`tailscale serve --bg 8787`). Never forward public traffic to trust mode without
authentication at the proxy.

## Tokens

Use [CLI commands](../reference/cli.md) to create, list, and revoke tokens.

- Use one token per client; the secret is shown once.
- Tokens have full access and do not expire.
- The database stores hashes, not secrets.
- Send `Authorization: Bearer <token>`; never put tokens in URLs or commits.
- Create a replacement before revoking a lost token.

## HTTPS and proxies

Use HTTPS outside localhost. Preserve `Host` and `Authorization`; do not log
authorization headers. Remove a proxy's HTTP Basic header before forwarding; the
proxy can supply a bearer token instead.

## Stored data

Restrict access to the database and backups. PantryPal does not encrypt them; use
volume encryption when needed. A restore also restores token state, so
revoked tokens can become valid again. Review tokens after a restore.

See [Configuration](configuration.md), [Backups and restore](backups.md), and
[Troubleshooting](troubleshooting.md).
