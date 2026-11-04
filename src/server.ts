import { serve } from "@hono/node-server";
import { createApp } from "./api/app.js";
import { defaultWebDir, hasWebApp } from "./api/web.js";
import { openDb, runMigrations } from "./db/client.js";

const DEFAULT_PORT = 8787;

const dbPath = process.env.PANTRYPAL_DB_PATH ?? "./data/pantrypal.db";
const hostname = process.env.HOST ?? "0.0.0.0";
const parsedPort = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
const port = Number.isFinite(parsedPort) ? parsedPort : DEFAULT_PORT;
const trustNetwork = ["1", "true"].includes(process.env.PANTRYPAL_TRUST_NETWORK?.trim().toLowerCase() ?? "");
const webDir = defaultWebDir();
const serveWeb = hasWebApp(webDir);

const { db, sqlite } = openDb(dbPath);
runMigrations(db);

const app = createApp({ db, trustNetwork, ...(serveWeb ? { webDir } : {}) });

if (trustNetwork) {
  console.log(
    "PANTRYPAL_TRUST_NETWORK is on: /api/v1 requests without a token act as the household. /mcp still requires a token.",
  );
}
if (serveWeb) {
  console.log(`Serving web app from ${webDir}`);
} else {
  console.log(`Web app not found at ${webDir}; serving the API only (build it with \`pnpm build\`).`);
}

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`PantryPal listening on http://${hostname}:${info.port}`);
  console.log(`Database: ${dbPath}`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down…`);
  const force = setTimeout(() => {
    console.error("Shutdown timed out; exiting.");
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close((error) => {
    try {
      if (error) console.error("Error closing HTTP server:", error);
      sqlite.close();
    } finally {
      process.exit(error ? 1 : 0);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
