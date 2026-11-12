import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import iconNames from "../src/lib/iconNames.json" with { type: "json" };

const iconsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "web",
  "src",
  "assets",
  "ingredients",
);

describe("ingredient icon manifest", () => {
  it("matches the web app's bundled icons", () => {
    const onDisk = readdirSync(iconsDir)
      .filter((file) => file.endsWith(".webp"))
      .map((file) => file.slice(0, -".webp".length))
      .sort();
    expect(iconNames, "Run `pnpm icons:manifest` to regenerate src/lib/iconNames.json").toEqual(
      onDisk,
    );
  });
});
