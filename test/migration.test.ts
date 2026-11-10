import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  new URL("../drizzle/0004_typical_black_bolt.sql", import.meta.url),
  "utf8",
);

/** A pre-0004 database with the location columns still in place. */
function legacyDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE ingredient (
      id text PRIMARY KEY NOT NULL,
      default_location text DEFAULT 'pantry' NOT NULL
    );
    CREATE TABLE pantry_item (
      id text PRIMARY KEY NOT NULL,
      household_id text NOT NULL,
      ingredient_id text NOT NULL,
      location text DEFAULT 'pantry' NOT NULL,
      qty real,
      unit text,
      qty_approx integer DEFAULT false NOT NULL,
      status text DEFAULT 'unknown' NOT NULL,
      raw_text text,
      note text,
      purchased_on text,
      opened_on text,
      expires_on text,
      last_verified_at text,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE UNIQUE INDEX pantry_item_uq ON pantry_item (household_id, ingredient_id, location);
    CREATE TABLE stock_movement (
      id text PRIMARY KEY NOT NULL,
      pantry_item_id text NOT NULL REFERENCES pantry_item(id) ON DELETE cascade
    );
    INSERT INTO ingredient (id) VALUES ('ing_a'), ('ing_b');
    INSERT INTO pantry_item (id, household_id, ingredient_id, location, qty, unit, status, note, purchased_on, last_verified_at, created_at, updated_at) VALUES
      ('pi_a1', 'h1', 'ing_a', 'pantry', 1, 'tsp', 'on_hand', 'first', '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('pi_a2', 'h1', 'ing_a', 'fridge', 2, 'tsp', 'on_hand', 'second', '2026-02-01', '2026-02-02T00:00:00.000Z', '2026-02-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z');
    INSERT INTO stock_movement (id, pantry_item_id) VALUES ('mv_a1', 'pi_a1'), ('mv_a2', 'pi_a2');

    INSERT INTO pantry_item (id, household_id, ingredient_id, location, qty, unit, status, note, last_verified_at, created_at, updated_at) VALUES
      ('pi_b1', 'h1', 'ing_b', 'pantry', 2, 'can', 'on_hand', NULL, '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
      ('pi_b2', 'h1', 'ing_b', 'fridge', 10, 'oz', 'on_hand', 'converted can', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);
  for (const statement of MIGRATION.split("--> statement-breakpoint")) {
    if (statement.trim() !== "") db.exec(statement);
  }
  return db;
}

describe("pantry location removal migration", () => {
  it("drops location and keeps one row per ingredient", () => {
    const db = legacyDb();
    try {
      expect(
        db
          .prepare<[], { n: number }>(
            "SELECT count(*) AS n FROM pragma_table_info('pantry_item') WHERE name = 'location'",
          )
          .get()?.n,
      ).toBe(0);
      expect(
        db
          .prepare<[], { n: number }>(
            "SELECT count(*) AS n FROM pragma_table_info('ingredient') WHERE name = 'default_location'",
          )
          .get()?.n,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  it("sums same-unit duplicates and keeps the most recently verified row otherwise", () => {
    const db = legacyDb();
    try {
      const a = db
        .prepare("SELECT id, qty, unit, note, purchased_on FROM pantry_item WHERE ingredient_id = 'ing_a'")
        .get();
      expect(a).toMatchObject({ id: "pi_a2", qty: 3, unit: "tsp", note: "second", purchased_on: "2026-02-01" });

      const b = db
        .prepare("SELECT id, qty, unit, note FROM pantry_item WHERE ingredient_id = 'ing_b'")
        .get();
      expect(b).toMatchObject({ id: "pi_b1", qty: 2, unit: "can", note: "converted can" });

      // Moves on the merged rows survive on the surviving row.
      expect(
        db.prepare("SELECT pantry_item_id FROM stock_movement WHERE id = 'mv_a1'").get(),
      ).toEqual({ pantry_item_id: "pi_a2" });
    } finally {
      db.close();
    }
  });
});
