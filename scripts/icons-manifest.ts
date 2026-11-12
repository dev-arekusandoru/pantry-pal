/**
 * Regenerate `src/lib/iconNames.json` from the web app's bundled ingredient icons.
 * The server must not read the web folder at runtime, so this snapshot ships instead.
 * Run `pnpm icons:manifest` after adding or removing an icon.
 */
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = path.join(root, "web", "src", "assets", "ingredients");
const out = path.join(root, "src", "lib", "iconNames.json");

const names = readdirSync(iconsDir)
  .filter((file) => file.endsWith(".webp"))
  .map((file) => file.slice(0, -".webp".length))
  .sort();

writeFileSync(out, `${JSON.stringify(names, null, 2)}\n`);
console.log(`Wrote ${names.length} icon names to ${path.relative(root, out)}`);
