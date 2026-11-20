# Waitlist service

The waitlist service collects email addresses from sign-up forms on static
websites, such as the landing page. One process serves many sites. It is not
part of the PantryPal app and has its own database. Self-hosters do not need it.

The service does these tasks:

- Takes `POST` requests from the forms of the sites that you list.
- Saves each address once. A repeat sign-up does not make a second row.
- Sends one welcome email with an unsubscribe link, if you set up SMTP.
- Lets you list, export, and mark invited addresses with a command.

The service does not send invitations. `invite` only marks people as invited.

## Configure

Create `waitlist/config/waitlist.config.json`. Start from
`waitlist/config/waitlist.config.example.json`. Git ignores this file.

| Key | Required | Purpose |
| --- | --- | --- |
| `publicUrl` | Yes | Public URL of the service. Unsubscribe links use it. |
| `trustedIpHeader` | No | Request header that holds the client IP address, for example `cf-connecting-ip` behind Cloudflare. Without it, the rate limit uses the socket address, which is the proxy. Set it only when a proxy that you trust sets the header. |
| `smtp` | No | `host`, `port` (default `587`), `secure` (default `false`; `true` for port 465), `user`, and `from`. Without it, the service saves addresses and sends no email. |
| `sites` | Yes | One entry per website. The key is the site ID: lowercase letters, digits, and hyphens. |
| `sites.<id>.name` | Yes | Name that the welcome email uses. |
| `sites.<id>.origins` | Yes | Origins that may post, for example `https://example.com`. No path, no trailing slash. |
| `sites.<id>.welcome` | No | `subject` and `text` of the welcome email. `{{name}}` and `{{unsubscribeUrl}}` are replaced. |

Secrets are environment variables, not file keys:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WAITLIST_SECRET` | None. Required. | Random string of at least 16 characters. It signs unsubscribe links. If you change it, old links stop working. |
| `SMTP_PASSWORD` | None. Required with `smtp`. | SMTP password. |
| `WAITLIST_CONFIG` | `waitlist.config.json`; image: `/config/waitlist.config.json` | Path of the config file. |
| `WAITLIST_DB_PATH` | `data/waitlist.db`; image: `/data/waitlist.db` | SQLite file. Use the same path for the server and the commands. |
| `PORT` | `8790` | HTTP listen port. |
| `HOST` | `127.0.0.1`; image: `0.0.0.0` | HTTP bind address. |

The service stops at start-up with a message if the config is not valid.

## Run

From source:

```sh
WAITLIST_SECRET=replace-with-a-long-random-string pnpm waitlist:dev
```

With Docker, behind the same Cloudflare Tunnel as PantryPal:

1. Create `waitlist/config/waitlist.config.json`.
2. Add `WAITLIST_SECRET` (and `SMTP_PASSWORD` if needed) to `.env`.
3. Start the tunnel stack, then run
   `docker compose -f docker-compose.waitlist.yml up -d --build`.
4. In the Cloudflare dashboard, add a public hostname for the service. Set the
   service to `http://waitlist:8790`.

The waitlist stack is separate from the PantryPal stacks. Rebuilding them does
not stop it. The data is in `waitlist/data/`. Back up this directory.

## Add a form to a site

Post JSON to `/v1/sites/<site id>/subscribe`:

```js
await fetch("https://waitlist.example.com/v1/sites/my-site/subscribe", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, website: "" }),
});
```

Add an input named `website` to the form, and hide it from people. Bots fill it
in. The service then discards the sign-up and still answers `200`.

| Status | Meaning |
| --- | --- |
| `200` | Saved, or discarded as a bot. Body: `{"ok":true}`. |
| `400` | The address or the JSON is not valid. |
| `403` | The `Origin` header is not in the site's `origins`. |
| `404` | Unknown site ID. |
| `413` | The body is larger than 2 KB. |
| `429` | More than 5 sign-ups from one client in 10 minutes. `Retry-After` gives the seconds. |

The origin check keeps other websites' scripts out of a browser. It is not
authentication: a script outside a browser can set any `Origin`.

The landing page form already does this. Set `waitlistEndpoint` in
`landing/src/config.ts` to the `subscribe` URL of the `pantrypal` site.

## Manage the list

Run these commands from the repository root. Use the same `WAITLIST_DB_PATH` as
the server. In Docker:
`docker compose -f docker-compose.waitlist.yml exec waitlist node dist/cli.js <command>`.

| Command | Result |
| --- | --- |
| `pnpm waitlist:cli count [--site ID]` | Active addresses, and how many are not invited. |
| `pnpm waitlist:cli list [--site ID] [--pending]` | Active addresses, oldest first. `--pending` hides invited addresses. |
| `pnpm waitlist:cli export [--site ID] [--pending]` | CSV on standard output: `site,email,created_at,invited_at`. |
| `pnpm waitlist:cli invite --site ID --next N` | Marks the N oldest not-invited addresses as invited and prints them. |
| `pnpm waitlist:cli invite --site ID EMAIL...` | Marks the listed addresses as invited. |
| `pnpm waitlist:cli remove --site ID EMAIL` | Deletes one address. |

Addresses that unsubscribed do not appear in any list. A person who signs up
again after unsubscribing returns to the list. They get no second welcome email.

## Email and privacy

- The welcome email goes out once for each address. This stops the form from
  being used to send repeat mail to a third person.
- If SMTP fails, the address is still saved. The service tries again at the next
  sign-up of the same address.
- Every email has a `List-Unsubscribe` header and a link in the text. The link
  opens a page with a button. The change happens when a person selects the
  button, so mail scanners that open links do not unsubscribe anyone.
- The service stores the address, the site ID, and the time of each step. It
  stores no IP addresses. Say this in the privacy policy of each site.
