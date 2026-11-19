import { and, eq, sql } from "drizzle-orm";
import { makeCtx, type Ctx } from "../context.js";
import type { Db } from "../db/client.js";
import { ingredientMeasures, ingredients, pantryItems } from "../db/schema.js";
import { newId } from "../lib/ids.js";
import { builtinFactor, canonicalUnit, unitFamily } from "./unitNames.js";
import { converterFor } from "./units.js";

/** What the one-time units data step did. `lines` is the log, one entry per row it could not convert. */
export interface LegacyUnitsReport {
  /** False when the database had nothing left to migrate (the step already ran, or it is a fresh database). */
  migrated: boolean;
  measuresCreated: number;
  /** Conversion rows that could not become a measure (dropped). */
  conversionsDropped: number;
  stockUnitsSet: number;
  pantryConverted: number;
  /** Pantry rows left in their own unit because it does not convert into the stock unit. */
  pantryNotConverted: number;
  parConverted: number;
  /** Par levels removed because they could not convert and the units differed. */
  parDropped: number;
  lines: string[];
}

interface ConversionRow {
  ingredientId: string | null;
  householdId: string;
  fromUnit: string;
  toUnit: string;
  factor: number;
  note: string | null;
}

interface IngredientRow {
  id: string;
  householdId: string;
  name: string;
  stockUnit: string | null;
  parQty: number | null;
  parUnit: string | null;
}

interface PantryRow {
  id: string;
  ingredientId: string;
  qty: number | null;
  unit: string | null;
}

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

function describe(qty: number, unit: string | null): string {
  return `${round(qty)} ${unit ?? "count"}`;
}

function emptyReport(): LegacyUnitsReport {
  return {
    migrated: false,
    measuresCreated: 0,
    conversionsDropped: 0,
    stockUnitsSet: 0,
    pantryConverted: 0,
    pantryNotConverted: 0,
    parConverted: 0,
    parDropped: 0,
    lines: [],
  };
}

/**
 * One-time data step for the units model (runs at startup, after the schema migration; safe to run
 * every start). Before it, the database has the old shapes: `unit_conversion` rows and
 * `ingredient.par_unit` (the schema migration leaves both in place, because dropping them first
 * would lose the data). The step, in one transaction:
 *
 * 1. turns every per-ingredient conversion row into a measure (grams of one unit) when the chain
 *    reaches grams through built-in units, the linked food's measures or other converted rows;
 * 2. sets each missing stock unit from the pantry row's unit;
 * 3. converts pantry amounts into the stock unit (rows that do not convert stay as they are; the
 *    review list flags them with the "unit" reason);
 * 4. converts par into the stock unit (kept as is only when the units are equal, otherwise cleared);
 * 5. drops `unit_conversion` and `ingredient.par_unit`.
 *
 * Step 5 is also the marker: once the legacy objects are gone the step does nothing.
 */
export function migrateLegacyUnits(db: Db, now: () => Date = () => new Date()): LegacyUnitsReport {
  const columns = db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info('ingredient')`);
  const hasParUnit = columns.some((column) => column.name === "par_unit");
  const hasConversions =
    db.all(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'unit_conversion'`).length > 0;
  if (!hasParUnit && !hasConversions) return emptyReport();

  return db.transaction((tx) => {
    const report = emptyReport();
    report.migrated = true;
    const handle = tx as unknown as Db;
    const timestamp = now().toISOString();
    const contexts = new Map<string, Ctx>();
    const ctxFor = (householdId: string): Ctx => {
      let ctx = contexts.get(householdId);
      if (!ctx) {
        ctx = makeCtx(handle, householdId, now);
        contexts.set(householdId, ctx);
      }
      return ctx;
    };

    const conversions = hasConversions
      ? handle.all<ConversionRow>(sql`
          SELECT ingredient_id AS ingredientId, household_id AS householdId, from_unit AS fromUnit,
                 to_unit AS toUnit, factor, note
          FROM unit_conversion ORDER BY household_id, ingredient_id, from_unit, to_unit, id`)
      : [];
    const rows = handle.all<IngredientRow>(sql`
      SELECT id, household_id AS householdId, name, stock_unit AS stockUnit, par_qty AS parQty,
             ${hasParUnit ? sql.raw("par_unit") : sql.raw("NULL")} AS parUnit
      FROM ingredient ORDER BY name, id`);
    const byId = new Map(rows.map((row) => [row.id, row] as const));

    // 1. Conversion rows → measures.
    const global = conversions.filter((row) => row.ingredientId === null);
    if (global.length > 0) {
      report.conversionsDropped += global.length;
      for (const row of global) {
        report.lines.push(
          `Dropped household-wide conversion 1 ${row.fromUnit} = ${row.factor} ${row.toUnit}: measures belong to one ingredient.`,
        );
      }
    }
    const perIngredient = new Map<string, ConversionRow[]>();
    for (const row of conversions) {
      if (row.ingredientId === null) continue;
      perIngredient.set(row.ingredientId, [...(perIngredient.get(row.ingredientId) ?? []), row]);
    }

    for (const [ingredientId, list] of perIngredient) {
      const ingredient = byId.get(ingredientId);
      if (ingredient === undefined) continue;
      const ctx = ctxFor(ingredient.householdId);
      const created = new Map<string, number>();

      const apply = (row: ConversionRow, unit: string, grams: number): void => {
        const value = Math.round(grams * 1e4) / 1e4;
        const known = created.get(unit);
        if (known !== undefined) {
          if (Math.abs(known - value) / value > 0.01) {
            report.lines.push(
              `${ingredient.name}: kept 1 ${unit} = ${known} g; 1 ${row.fromUnit} = ${row.factor} ${row.toUnit} would make it ${value} g.`,
            );
          }
          return;
        }
        created.set(unit, value);
        handle
          .insert(ingredientMeasures)
          .values({
            id: newId("im"),
            householdId: ingredient.householdId,
            ingredientId,
            unit,
            grams: value,
            note: row.note,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .onConflictDoUpdate({
            target: [ingredientMeasures.ingredientId, ingredientMeasures.unit],
            set: { grams: value, note: row.note, updatedAt: timestamp },
          })
          .run();
        report.measuresCreated += 1;
      };

      const canMeasure = (unit: string): boolean => builtinFactor(unit, "mass") === null && unit !== "dozen";

      /** true = handled (measure created, or nothing to do); false = no path to grams yet. */
      const resolve = (row: ConversionRow): boolean => {
        const from = canonicalUnit(row.fromUnit);
        const to = canonicalUnit(row.toUnit);
        if (from === null || to === null) return false;
        const family = unitFamily(from);
        if (from === to || (family !== null && family === unitFamily(to))) return true;
        const convert = converterFor(ctx, ingredientId);
        const gramsOfTo = convert(1, to, "g");
        if (gramsOfTo !== null && canMeasure(from)) {
          apply(row, from, row.factor * gramsOfTo);
          return true;
        }
        const gramsOfFrom = convert(1, from, "g");
        if (gramsOfFrom !== null && canMeasure(to)) {
          apply(row, to, gramsOfFrom / row.factor);
          return true;
        }
        return false;
      };

      // Rows that end in a built-in unit define their unit outright; the rest build on them.
      const builtinTarget = (row: ConversionRow): boolean => {
        const to = canonicalUnit(row.toUnit);
        return to !== null && unitFamily(to) !== null;
      };
      let pending = [...list.filter(builtinTarget), ...list.filter((row) => !builtinTarget(row))];
      for (let progress = true; progress && pending.length > 0; ) {
        const before = pending.length;
        pending = pending.filter((row) => !resolve(row));
        progress = pending.length < before;
      }
      for (const row of pending) {
        report.conversionsDropped += 1;
        report.lines.push(
          `${ingredient.name}: dropped 1 ${row.fromUnit} = ${row.factor} ${row.toUnit}; it does not reach grams. Add a measure for ${row.fromUnit} or ${row.toUnit}.`,
        );
      }
    }

    // 2-4. Stock unit, pantry amounts and par.
    const pantryRows = handle.all<PantryRow>(sql`
      SELECT id, ingredient_id AS ingredientId, qty, unit FROM pantry_item ORDER BY ingredient_id, id`);
    const pantryByIngredient = new Map<string, PantryRow[]>();
    for (const row of pantryRows) {
      pantryByIngredient.set(row.ingredientId, [...(pantryByIngredient.get(row.ingredientId) ?? []), row]);
    }

    for (const ingredient of rows) {
      const ctx = ctxFor(ingredient.householdId);
      const stocked = pantryByIngredient.get(ingredient.id) ?? [];
      let stockUnit = ingredient.stockUnit;
      const setStockUnit = (unit: string, why: string): string => {
        handle.update(ingredients).set({ stockUnit: unit }).where(eq(ingredients.id, ingredient.id)).run();
        report.stockUnitsSet += 1;
        report.lines.push(`${ingredient.name}: stock unit set to ${unit} (${why}).`);
        return unit;
      };

      // The unit the person sees today wins: the pantry row's unit when it has an amount, then the
      // old default unit, then any pantry row unit.
      const measured = stocked.find((row) => row.qty !== null && row.unit !== null)?.unit ?? null;
      if (measured !== null && measured !== stockUnit) {
        stockUnit = setStockUnit(
          measured,
          ingredient.stockUnit === null ? "from the pantry row" : `from the pantry row; default unit was ${ingredient.stockUnit}`,
        );
      } else if (stockUnit === null) {
        const fromPantry = stocked.find((row) => row.unit !== null)?.unit ?? null;
        if (fromPantry !== null) stockUnit = setStockUnit(fromPantry, "from the pantry row");
      }

      if (stockUnit !== null) {
        const target = stockUnit;
        const convert = converterFor(ctx, ingredient.id);
        for (const row of stocked) {
          if (row.unit === target) continue;
          if (row.qty === null) {
            handle.update(pantryItems).set({ unit: target }).where(eq(pantryItems.id, row.id)).run();
            continue;
          }
          const converted = convert(row.qty, row.unit, target);
          if (converted === null) {
            report.pantryNotConverted += 1;
            report.lines.push(
              `${ingredient.name}: pantry ${describe(row.qty, row.unit)} left as is; it does not convert to the stock unit ${target}. Add a measure.`,
            );
            continue;
          }
          const qty = round(converted);
          handle
            .update(pantryItems)
            .set({ qty, unit: target })
            .where(and(eq(pantryItems.id, row.id), eq(pantryItems.ingredientId, ingredient.id)))
            .run();
          report.pantryConverted += 1;
          report.lines.push(
            `${ingredient.name}: pantry ${describe(row.qty, row.unit)} → ${describe(qty, target)}.`,
          );
        }
      }

      if (ingredient.parQty !== null) {
        // A par without a unit was written in the old default unit.
        const parUnit = ingredient.parUnit ?? ingredient.stockUnit;
        if (stockUnit === null && parUnit !== null) stockUnit = setStockUnit(parUnit, "from the par unit");
        const convert = converterFor(ctx, ingredient.id);
        const converted = convert(ingredient.parQty, parUnit, stockUnit);
        const before = describe(ingredient.parQty, parUnit);
        if (converted === null) {
          report.parDropped += 1;
          handle.update(ingredients).set({ parQty: null }).where(eq(ingredients.id, ingredient.id)).run();
          report.lines.push(
            `${ingredient.name}: par ${before} cleared; it does not convert to the stock unit ${stockUnit ?? "count"}.`,
          );
        } else if (parUnit !== stockUnit) {
          const parQty = round(converted);
          handle.update(ingredients).set({ parQty }).where(eq(ingredients.id, ingredient.id)).run();
          report.parConverted += 1;
          report.lines.push(`${ingredient.name}: par ${before} → ${describe(parQty, stockUnit)}.`);
        }
      }
    }

    // 5. The legacy objects go; their absence is what stops this step from running again.
    if (hasParUnit) handle.run(sql`ALTER TABLE ingredient DROP COLUMN par_unit`);
    if (hasConversions) handle.run(sql`DROP TABLE unit_conversion`);
    return report;
  });
}
