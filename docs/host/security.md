# Access and security

PantryPal has accounts. Each account signs in with an email and password and owns
one household. Bearer tokens protect API and MCP clients and grant full access to
the token's household.

## Access rules

| Path | Required access |
| --- | --- |
| Web app, static files | Public |
| `/health`, `/openapi.json`, `/auth/session` | Public |
| `/auth/signup`, `/auth/login`, `/auth/logout` | Public, same-origin |
| `/api/v1/*` | Bearer token or session cookie |
| `/mcp` | Bearer token, always |

## Authentication precedence

1. A sent `Authorization` header must be a valid bearer token; an invalid token
   returns `401`, even with a valid session cookie.
2. Otherwise a valid session cookie authenticates `/api/v1` as its account's
   household. Unsafe methods also need a same-origin request.
3. Otherwise the request returns `401`.

`/mcp` never accepts a cookie. There is no anonymous or network-trust mode.

## Accounts and signup

`PANTRYPAL_SIGNUP` controls new accounts:

- `open` (default): the web app shows a signup form. Anyone who can reach the app
  can create an account and household.
- `closed`: signup returns `403`. Existing accounts sign in as usual. Create
  accounts with `pantrypal account create --email … --household …`.

Signup validates the email, requires a password of at least 8 characters, and
rejects an email that already has an account. A torn-down signup leaves no
household behind.

Keep signup open only while you need it. After you create your household, set
`PANTRYPAL_SIGNUP=closed` and restart the app.

## Sessions

A session cookie lasts 30 days. It is `HttpOnly`, `Secure`, `SameSite=Lax`, and
scoped to `/`. The database stores only a hash of the cookie value, so a copy of
the database cannot be replayed as a cookie.

- Logout deletes the session row and clears the cookie.
- `pantrypal account reset-password <email>` sets a new password and deletes every
  session of that account.
- There is no email verification or self-service password reset. An admin resets
  the password with the CLI.

Login and signup are throttled per socket peer: 10 attempts per 15 minutes. The
counter lives in the server process, so a restart clears it and several server
processes do not share it. Login accepts JSON only, limits the body to 8 KiB
(`413`), and returns the same `401` for a wrong password and an unknown email.
Login, signup, and logout need an `Origin` equal to `Host`, over HTTPS except for
loopback development. `X-Forwarded-Host` is ignored and
`Sec-Fetch-Site: cross-site` is rejected. See the
[REST API reference](../reference/rest-api.md#account-endpoints).

Use HTTPS outside `http://localhost`. For public access, use
[Cloudflare Tunnel](tunnel.md). Do not put Cloudflare Access in front of it; that
would block MCP bearer tokens.

## Expose only what you need

The default Compose stack publishes the port on `127.0.0.1` only. Keep that
binding for local use. For remote private access, use a VPN or tailnet (for
Tailscale: `tailscale serve --bg 8787`). A public install needs HTTPS, an account,
and `PANTRYPAL_SIGNUP=closed`.

## Tokens

Use [CLI commands](../reference/cli.md) to create, list, and revoke tokens. Select
the household with `--household-id` or `--email` when the instance has more than
one.

- Use one token per client; the secret is shown once.
- Tokens grant full access to their household and do not expire.
- The database stores hashes, not secrets.
- Send `Authorization: Bearer <token>`; never put tokens in URLs or commits.
- Create a replacement before revoking a lost token.

## HTTPS and proxies

Use HTTPS outside localhost. Preserve `Host` and `Authorization`; do not log
authorization headers. Remove a proxy's HTTP Basic header before forwarding; the
proxy can supply a bearer token instead.

## Stored data

Restrict access to the database and backups. PantryPal does not encrypt them; use
volume encryption when needed. The database holds password hashes (scrypt) and
session hashes. A restore also restores token and session state, so revoked
tokens can become valid again. Review tokens after a restore.

See [Configuration](configuration.md), [Backups and restore](backups.md), and
[Troubleshooting](troubleshooting.md).
