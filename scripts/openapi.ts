/**
 * Dump the OpenAPI document to web/openapi.json without starting a server.
 * `pnpm openapi` runs this, then openapi-typescript for web/src/api/schema.d.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/api/app.js";
import { openDb } from "../src/db/client.js";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "openapi.json");

const { db, sqlite } = openDb(":memory:");
try {
  const app = createApp({ db });
  const res = await app.request("/openapi.json");
  if (!res.ok) throw new Error(`GET /openapi.json returned ${res.status}`);
  const doc: unknown = await res.json();
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);
} finally {
  sqlite.close();
}
