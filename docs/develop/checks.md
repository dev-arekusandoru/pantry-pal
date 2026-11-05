# Tests and checks

Run commands from the repository root after you install dependencies.

| Command | Check |
| --- | --- |
| `pnpm typecheck` | Server and web app types |
| `pnpm test` | API, service, database, and MCP tests |
| `pnpm test:web` | Web app tests in jsdom |
| `pnpm test:all` | Both test suites |
| `pnpm build` | Compile the server and build the web app |

## Check a change

1. Run the tests for the changed behavior.
2. Run the type check.
3. Run the app and use the changed feature.
4. For a release, run both suites and the build.

Server tests use an in-memory database. Test helpers supply a clock for
repeatable date checks. Web tests use Vitest and Testing Library. They do not
replace checks in a real browser.

## Update API types

After you change API schemas or routes:

```sh
pnpm openapi
```

This updates `web/openapi.json` and `web/src/api/schema.d.ts`.
Include both files in the change. See [REST API](../reference/rest-api.md).
