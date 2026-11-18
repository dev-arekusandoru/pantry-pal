# Local setup

Requires Node.js 22 or later and pnpm. Run these commands from the repository root.

## Set up the database

```sh
git clone https://github.com/dev-arekusandoru/pantry-pal.git
cd pantry-pal
pnpm install
pnpm cli account create --email you@example.com --household "Our House"
```

The CLI asks for a password twice. The default database is `data/pantrypal.db`. To use sample food and recipes, follow
[Example data](../start/example-data.md) before you add your own data.

## Run the app

In one terminal, start the API:

```sh
HOST=127.0.0.1 pnpm dev
```

In a second terminal, start the web app:

```sh
pnpm web:dev --host 127.0.0.1
```

Open the URL that Vite prints. The web app sends API requests through the Vite
proxy to `http://127.0.0.1:4787`. Set `PANTRYPAL_API_URL` on the Vite process
to use another API address.

The Vite dev server proxies `/auth` and `/api` to the API. Open the app at
`http://localhost:5173` and sign in with the account you created, or sign up
while `PANTRYPAL_SIGNUP` stays `open` (the default). Browsers accept the `Secure`
session cookie on localhost over HTTP.

Keep both servers on loopback. Anyone who can reach the API can attempt a login.
See [Access and security](../host/security.md).

## Run the built app

```sh
pnpm build
HOST=127.0.0.1 pnpm start
```

Open `http://127.0.0.1:4787`. The server now serves both the web app and API.
Sign in with your account.

Next: [Tests and checks](checks.md) · [Architecture](architecture.md)
