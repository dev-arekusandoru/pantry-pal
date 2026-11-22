import { serve } from "@hono/node-server";
import { createApp } from "./api/app.js";
import { defaultWebDir, hasWebApp } from "./api/web.js";
import { startLifecycleJob } from "./billing/lifecycle.js";
import { ConfigError, loadHostedConfig } from "./config.js";
import { openDb, runMigrations } from "./db/client.js";
import { createHosted } from "./hosted.js";
import { titleCaseIngredientNames } from "./services/ingredients.js";
import { migrateLegacyUnits } from "./services/legacyUnits.js";
import { backfillNutritionMatches } from "./services/nutrition.js";

const DEFAULT_PORT = 4787;

const dbPath = process.env.PANTRYPAL_DB_PATH ?? "./data/pantrypal.db";
const hostname = process.env.HOST ?? "0.0.0.0";
const parsedPort = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
const port = Number.isFinite(parsedPort) ? parsedPort : DEFAULT_PORT;
const signupOpen = (process.env.PANTRYPAL_SIGNUP ?? "open").trim().toLowerCase() !== "closed";
const webDir = defaultWebDir();
const serveWeb = hasWebApp(webDir);

let hostedConfig: ReturnType<typeof loadHostedConfig>;
try {
  hostedConfig = loadHostedConfig();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`Configuration error: ${error.message}`);
  process.exit(1);
}
const hosted = createHosted(hostedConfig);

const { db, sqlite } = openDb(dbPath);
runMigrations(db);
const backfilled = backfillNutritionMatches(db);
if (backfilled > 0) console.log(`Matched ${backfilled} ingredient(s) to USDA foods.`);
const renamed = titleCaseIngredientNames(db);
if (renamed > 0) console.log(`Set ${renamed} ingredient name(s) to Title Case.`);
// After the USDA backfill: the data step reads the linked foods' measures. It drops the legacy
// unit tables, so it runs once; see migrateLegacyUnits.
const units = migrateLegacyUnits(db);
if (units.migrated) {
  console.log(
    `Units migration: ${units.measuresCreated} measure(s) created, ${units.conversionsDropped} conversion(s) dropped, ` +
      `${units.stockUnitsSet} stock unit(s) set, ${units.pantryConverted} pantry row(s) converted, ` +
      `${units.pantryNotConverted} left unconverted, ${units.parConverted} par level(s) converted, ${units.parDropped} cleared.`,
  );
  for (const line of units.lines) console.log(`  ${line}`);
}

const app = createApp({
  db,
  signupOpen,
  hosted,
  ...(serveWeb ? { webDir } : {}),
});

console.log(
  signupOpen
    ? "Signup is open: anyone who can reach this instance can create an account and household."
    : "Signup is closed: existing accounts can sign in. Create accounts with `pantrypal account create`.",
);
console.log(
  `Email: ${hosted.mailer ? "on" : "off"}. Billing: ${hosted.billing ? `Polar (${hostedConfig.polar?.server})` : "off"}.`,
);
if (serveWeb) {
  console.log(`Serving web app from ${webDir}`);
} else {
  console.log(`Web app not found at ${webDir}; serving the API only (build it with \`pnpm build\`).`);
}

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`Rakumi listening on http://${hostname}:${info.port}`);
  console.log(`Database: ${dbPath}`);
});

// Billing on: lock and delete households whose plan ended (at startup, then daily).
const stopLifecycle =
  hosted.billing !== null && hosted.mailer !== null && hosted.publicUrl !== null
    ? startLifecycleJob({ db, billing: hosted.billing, mailer: hosted.mailer, publicUrl: hosted.publicUrl })
    : () => {};

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  stopLifecycle();
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
