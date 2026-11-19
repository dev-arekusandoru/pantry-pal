import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeCtx, type Ctx } from "../src/context.js";
import { openDb, type Db } from "../src/db/client.js";
import { createHousehold } from "../src/services/households.js";
import { listIngredientsForReview } from "../src/services/ingredients.js";
import { migrateLegacyUnits } from "../src/services/legacyUnits.js";
import { listMeasures } from "../src/services/units.js";

const OZ_IN_G = 28.349523125;

interface Journal {
  entries: Array<{ tag: string }>;
}

function applyMigration(sqlite: { exec(sql: string): unknown }, tag: string): void {
  const text = readFileSync(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8");
  for (const statement of text.split("--> statement-breakpoint")) {
    if (statement.trim() !== "") sqlite.exec(statement);
  }
}

/** A database as production has it before this change: migrations 0000-0007 plus real-shaped rows. */
function legacyDatabase(): { db: Db; ctx: Ctx; sqlite: ReturnType<typeof openDb>["sqlite"] } {
  const { db, sqlite } = openDb(":memory:");
  const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as Journal;
  const tags = journal.entries.map((entry) => entry.tag);
  const unitsIndex = tags.indexOf("0008_units_measures");
  expect(unitsIndex).toBeGreaterThan(0);
  for (const tag of tags.slice(0, unitsIndex)) applyMigration(sqlite, tag);

  const household = createHousehold(db, { name: "Legacy" });
  const h = household.id;
  const ingredient = sqlite.prepare(
    "INSERT INTO ingredient (id, household_id, name, normalized_name, default_unit, par_qty, par_unit) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const pantry = sqlite.prepare(
    "INSERT INTO pantry_item (id, household_id, ingredient_id, qty, unit, status) VALUES (?, ?, ?, ?, ?, 'on_hand')",
  );
  const conversion = sqlite.prepare(
    "INSERT INTO unit_conversion (id, household_id, ingredient_id, from_unit, to_unit, factor, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const add = (id: string, name: string, defaultUnit: string | null, par: [number, string | null] | null = null): void => {
    ingredient.run(id, h, name, name.toLowerCase(), defaultUnit, par?.[0] ?? null, par?.[1] ?? null);
  };

  // can = 14.5 oz and the pantry holds ounces: the pantry unit wins over the default unit (can).
  add("ing_tomato", "Tomatoes", "can");
  conversion.run("uc_1", h, "ing_tomato", "can", "oz", 14.5, "One 14.5 oz can.");
  pantry.run("pi_tomato", h, "ing_tomato", 10, "oz");
  // Par in liters, pantry in liters, default ml: the stock unit becomes l and the par is already in it.
  add("ing_oil", "Olive Oil", "ml", [2, "l"]);
  pantry.run("pi_oil", h, "ing_oil", 1, "l");
  // Par without a unit was written in the old default unit (ml); the pantry unit (l) wins, so par converts.
  add("ing_broth", "Broth", "ml", [500, null]);
  pantry.run("pi_broth", h, "ing_broth", 1, "l");
  // A row with no amount: the default unit is the stock unit and the row follows it.
  add("ing_paste", "Paste", "tbsp");
  pantry.run("pi_paste", h, "ing_paste", null, "cup");
  // No stock unit yet: the pantry row's unit becomes it.
  add("ing_flour", "Flour", null);
  pantry.run("pi_flour", h, "ing_flour", 3, "lb");
  // Cups have no density: the pantry row (2 cup) still sets the stock unit.
  add("ing_rice", "Rice", "lb");
  pantry.run("pi_rice", h, "ing_rice", 2, "cup");
  // Par that cannot convert and has another unit: cleared. Par in the stock unit: kept.
  add("ing_salt", "Salt", "g", [1, "cup"]);
  add("ing_pepper", "Pepper", "g", [50, "g"]);
  // A chain: clove = 3 g, head = 10 cloves.
  add("ing_garlic", "Garlic", "clove");
  conversion.run("uc_2", h, "ing_garlic", "head", "clove", 10, null);
  conversion.run("uc_3", h, "ing_garlic", "clove", "g", 3, null);
  // A conversion that never reaches grams, and a household-wide one: both dropped and logged.
  add("ing_mystery", "Mystery", null);
  conversion.run("uc_4", h, "ing_mystery", "can", "bag", 2, null);
  conversion.run("uc_5", h, null, "can", "oz", 12, null);

  applyMigration(sqlite, "0008_units_measures");
  return { db, ctx: makeCtx(db, h), sqlite };
}

interface Snapshot {
  ingredients: unknown[];
  pantry: unknown[];
  measures: unknown[];
}

function snapshot(sqlite: ReturnType<typeof openDb>["sqlite"]): Snapshot {
  return {
    ingredients: sqlite
      .prepare("SELECT id, stock_unit, par_qty FROM ingredient ORDER BY id")
      .all(),
    pantry: sqlite.prepare("SELECT id, qty, unit FROM pantry_item ORDER BY id").all(),
    measures: sqlite
      .prepare("SELECT ingredient_id, unit, grams FROM ingredient_measure ORDER BY ingredient_id, unit")
      .all(),
  };
}

describe("units data step", () => {
  it("turns conversions into measures, converts pantry and par into the stock unit and drops the legacy tables", () => {
    const { db, ctx, sqlite } = legacyDatabase();
    const report = migrateLegacyUnits(db);

    expect(report.migrated).toBe(true);
    // can (tomatoes), clove and head (garlic).
    expect(report.measuresCreated).toBe(3);
    expect(report.conversionsDropped).toBe(2);

    const measure = (ingredientId: string, unit: string) =>
      listMeasures(ctx, ingredientId).find((entry) => entry.unit === unit);
    expect(measure("ing_tomato", "can")).toMatchObject({ source: "user", note: "One 14.5 oz can." });
    expect(measure("ing_tomato", "can")!.grams).toBeCloseTo(14.5 * OZ_IN_G, 3);
    expect(measure("ing_garlic", "clove")!.grams).toBe(3);
    expect(measure("ing_garlic", "head")!.grams).toBe(30);

    // The pantry row's unit wins when it has an amount; the default unit decides otherwise.
    const stock = (id: string) =>
      sqlite.prepare("SELECT qty, unit FROM pantry_item WHERE id = ?").get(id) as { qty: number | null; unit: string };
    const stockUnit = (id: string) =>
      (sqlite.prepare("SELECT stock_unit FROM ingredient WHERE id = ?").get(id) as { stock_unit: string | null }).stock_unit;
    expect(stockUnit("ing_tomato")).toBe("oz");
    expect(stock("pi_tomato")).toEqual({ qty: 10, unit: "oz" });
    expect(stockUnit("ing_oil")).toBe("l");
    expect(stock("pi_oil")).toEqual({ qty: 1, unit: "l" });
    expect(stockUnit("ing_flour")).toBe("lb");
    expect(stock("pi_flour")).toEqual({ qty: 3, unit: "lb" });
    expect(stockUnit("ing_rice")).toBe("cup");
    expect(stock("pi_rice")).toEqual({ qty: 2, unit: "cup" });
    expect(stockUnit("ing_paste")).toBe("tbsp");
    expect(stock("pi_paste")).toEqual({ qty: null, unit: "tbsp" });
    expect(stockUnit("ing_garlic")).toBe("clove");
    // Tomatoes, Olive Oil, Flour, Rice and Broth changed or got a stock unit; Paste, Salt, Pepper and Garlic kept theirs.
    expect(report.stockUnitsSet).toBe(5);
    expect(report.pantryConverted).toBe(0);
    expect(report.pantryNotConverted).toBe(0);

    // Par values survive: converted into the stock unit, kept when already in it, cleared when it cannot convert.
    const par = (id: string) =>
      (sqlite.prepare("SELECT par_qty FROM ingredient WHERE id = ?").get(id) as { par_qty: number | null }).par_qty;
    expect(par("ing_oil")).toBe(2);
    expect(par("ing_broth")).toBe(0.5);
    expect(par("ing_pepper")).toBe(50);
    expect(par("ing_salt")).toBeNull();
    expect(report.parConverted).toBe(1);
    expect(report.parDropped).toBe(1);

    // Nothing needs a "unit" review: every pantry row is already in its stock unit.
    const review = listIngredientsForReview(ctx).map((entry) => entry.ingredient.id);
    expect(review).not.toContain("ing_rice");
    expect(review).not.toContain("ing_tomato");

    // The log names every row it did not convert.
    const log = report.lines.join("\n");
    expect(log).toContain("Tomatoes: stock unit set to oz (from the pantry row; default unit was can)");
    expect(log).toContain("Salt: par 1 cup cleared");
    expect(log).toContain("Mystery: dropped 1 can = 2 bag");
    expect(log).toContain("household-wide conversion 1 can = 12 oz");
    expect(log).toContain("Broth: par 500 ml → 0.5 l");

    // The legacy objects are gone.
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'unit_conversion'").all()).toEqual([]);
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM pragma_table_info('ingredient') WHERE name = 'par_unit'").get(),
    ).toEqual({ n: 0 });
  });

  it("is idempotent: a second run changes nothing and reports nothing", () => {
    const { db, sqlite } = legacyDatabase();
    expect(migrateLegacyUnits(db).migrated).toBe(true);
    const before = snapshot(sqlite);

    const second = migrateLegacyUnits(db);
    expect(second).toMatchObject({ migrated: false, measuresCreated: 0, pantryConverted: 0, lines: [] });
    expect(snapshot(sqlite)).toEqual(before);
  });

  it("runs once on a fresh database (the schema still has the legacy objects) and then does nothing", () => {
    const { db, sqlite } = openDb(":memory:");
    const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as Journal;
    for (const entry of journal.entries) applyMigration(sqlite, entry.tag);
    expect(migrateLegacyUnits(db)).toMatchObject({ migrated: true, measuresCreated: 0, lines: [] });
    expect(migrateLegacyUnits(db).migrated).toBe(false);
  });
});
