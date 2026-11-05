# Access and security

PantryPal has no user accounts or browser login. Every client with access can
read and change all household data.

## Access rules

| Path | Required access |
| --- | --- |
| Web app and static files | Public; these files contain no household data |
| `/health`, `/openapi.json` | Public |
| `/api/v1/*` | Bearer token, or network trust if enabled |
| `/mcp` | Bearer token, always |

## Network trust

`PANTRYPAL_TRUST_NETWORK=1` lets API requests without an `Authorization`
header act as the household. A token that is sent is still checked. A bad token
returns `401`. If no household exists, trusted requests return `503`.

The default Compose override enables trust and binds the host port to loopback.
Keep those settings together. Other containers on the shared `rakazo_app`
network can still reach the service directly. Treat them as trusted clients.

Do not forward public traffic to trust mode without access checks at the proxy.
For remote browser access, use a private VPN or tailnet. With Tailscale already
set up on the host, you can provide HTTPS with:

```sh
tailscale serve --bg 8787
```

Use the HTTPS address that Tailscale prints. Tailnet access rules control who
can reach it. Do not enable public sharing for this service.

The base Compose file alone disables trust. API and MCP clients then need
tokens; the web app cannot sign in.

## Tokens

Use [CLI commands](../reference/cli.md) to create, list, and revoke tokens.

- Use one token per client. The secret is shown only at creation.
- Tokens have full household access and do not expire.
- The database stores token hashes, not the secrets.
- Send `Authorization: Bearer <token>`. Never put tokens in URLs or commits.
- If a token is lost, create a new one and revoke the old one.

## HTTPS and proxies

Use HTTPS outside localhost. Forward bearer headers and JSON bodies unchanged.
Do not log authorization headers. MCP uses `POST` with JSON responses, not an
SSE stream.

If a proxy uses HTTP Basic auth with trust mode, remove its Basic header before
forwarding. Otherwise PantryPal returns `401`. A proxy can instead supply a
valid bearer token. It must authenticate visitors before forwarding requests.

## Stored data

Restrict access to the database and backups. PantryPal does not encrypt them;
use disk or volume encryption when needed.

A restore also restores token state. Previously revoked tokens can become valid
again. After a restore, list tokens and revoke those that must remain blocked.

See [Configuration](configuration.md) and [Backups and restore](backups.md).
