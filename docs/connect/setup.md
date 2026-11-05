# MCP setup

Connect an AI assistant through Model Context Protocol (MCP). The assistant can
read and change household data. First, [install PantryPal](../start/install.md).

## Create a token

For Docker Compose:

```sh
docker compose exec pantrypal node dist/cli.js token create --name assistant
```

For a source checkout, use `pnpm cli token create --name assistant`.
For the Cloudflare Tunnel stack, select its Compose file:
`docker compose -f docker-compose.tunnel.yml exec pantrypal node dist/cli.js token create --name assistant`.
Copy the secret now; it is shown only once. Use one token per client.
See [CLI commands](../reference/cli.md) to list or revoke tokens.

## Add the server

| Setting | Value |
| --- | --- |
| Transport | Streamable HTTP |
| URL, Docker | `http://localhost:8787/mcp` |
| URL, source checkout | `http://localhost:4787/mcp` |
| URL, Cloudflare Tunnel | `https://pantry.example.com/mcp` |
| Header | `Authorization: Bearer <token>` |

Use HTTPS for remote access. Keep tokens out of URLs and committed files. `/mcp`
always needs a bearer token: network trust and a browser session cookie never
apply. See [Public access with Cloudflare Tunnel](../host/tunnel.md) for a public
URL.

For clients that use this JSON format:

```json
{
  "mcpServers": {
    "pantrypal": {
      "type": "http",
      "url": "http://localhost:8787/mcp",
      "headers": {
        "Authorization": "Bearer REPLACE_WITH_TOKEN"
      }
    }
  }
}
```

For Claude Code, set `PANTRYPAL_TOKEN` to the secret, then run:

```sh
claude mcp add --transport http pantrypal http://localhost:8787/mcp \
  --header "Authorization: Bearer $PANTRYPAL_TOKEN"
```

Configuration formats vary by client. Use one that supports Streamable HTTP,
not the older SSE transport or stdio.

## Check the connection

Ask the client to list the tools, then read the household with `household_get`.
For a direct check, set `PANTRYPAL_TOKEN` and run:

```sh
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $PANTRYPAL_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The result lists the tools and their input schemas.

## Transport limits

The endpoint accepts JSON-RPC over `POST` and returns JSON. Requests do not use
sessions or a `Mcp-Session-Id`. With a valid token, `GET` and `DELETE` return
`405`. Do not configure an initial SSE stream.

For `401`, check the token. For `405`, check the method and transport.
See [Troubleshooting](../host/troubleshooting.md) for server checks.

Next: [Common tasks](tasks.md) · [Tool reference](../reference/mcp-tools.md)
