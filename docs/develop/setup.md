# Local setup

Requires Node.js 22 or later and pnpm. Run these commands from the repository root.

## Set up the database

```sh
git clone https://github.com/dev-arekusandoru/pantry-pal.git
cd pantry-pal
pnpm install
pnpm cli household init --name "Our House" --timezone Europe/London
```

The default database is `data/pantrypal.db`. To use sample food and recipes, follow
[Example data](../start/example-data.md) before you add your own data.

## Run the app

In one terminal, start the API:

```sh
HOST=127.0.0.1 PANTRYPAL_TRUST_NETWORK=1 pnpm dev
```

In a second terminal, start the web app:

```sh
pnpm web:dev --host 127.0.0.1
```

Open the URL that Vite prints. The web app sends API requests through the Vite
proxy to `http://127.0.0.1:4787`. Set `PANTRYPAL_API_URL` on the Vite process
to use another API address.

Network trust gives each visitor full access. Keep both servers on loopback.
See [Access and security](../host/security.md).

To test the browser login instead, set a password and drop network trust:

```sh
PANTRYPAL_PASSWORD='local-test-password' PANTRYPAL_REQUIRE_PASSWORD=1 pnpm dev
```

The Vite dev server proxies `/auth` and `/api` to the API. Open the app at
`http://localhost:5173`; browsers accept the `Secure` cookie on localhost over
HTTP. Setting `PANTRYPAL_PASSWORD` disables network trust, so do not keep
`PANTRYPAL_TRUST_NETWORK=1` in this mode.

## Run the built app

```sh
pnpm build
HOST=127.0.0.1 PANTRYPAL_TRUST_NETWORK=1 pnpm start
```

Open `http://127.0.0.1:4787`. The server now serves both the web app and API.

To test login in the built app, open `http://localhost:4787`:

```sh
HOST=127.0.0.1 PANTRYPAL_PASSWORD='local-test-password' PANTRYPAL_REQUIRE_PASSWORD=1 pnpm start
```

Next: [Tests and checks](checks.md) · [Architecture](architecture.md)
