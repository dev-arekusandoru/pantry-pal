import { describe, expect, it } from "vitest";
import type { Ctx } from "../src/context.js";
import { AppError } from "../src/lib/errors.js";
import { createIngredient } from "../src/services/ingredients.js";
import { canonicalUnit, normalizeUnit, unitFamily } from "../src/services/unitNames.js";
import {
  convert,
  deleteMeasure,
  listMeasures,
  setMeasure,
  validateUnit,
  validateUnits,
} from "../src/services/units.js";
import { makeTestCtx } from "./helpers.js";

const OZ_IN_G = 28.349523125;
const LB_IN_G = 453.59237;

function expectAppError(fn: () => unknown, code: string): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  throw new Error(`Expected an AppError with code ${code}`);
}

function custom(ctx: Ctx, name: string): string {
  return createIngredient(ctx, { custom: true, name }).id;
}

describe("normalizeUnit", () => {
  it("maps the common aliases to canonical units", () => {
    expect(normalizeUnit("lb")).toBe("lb");
    expect(normalizeUnit("Lbs")).toBe("lb");
    expect(normalizeUnit("pounds")).toBe("lb");
    expect(normalizeUnit("Ounce")).toBe("oz");
    expect(normalizeUnit("ounces")).toBe("oz");
    expect(normalizeUnit("Gram")).toBe("g");
    expect(normalizeUnit("grams")).toBe("g");
    expect(normalizeUnit("kg")).toBe("kg");
    expect(normalizeUnit("ml")).toBe("ml");
    expect(normalizeUnit("liters")).toBe("l");
    expect(normalizeUnit("litre")).toBe("l");
    expect(normalizeUnit("cups")).toBe("cup");
    expect(normalizeUnit("c")).toBe("cup");
    expect(normalizeUnit("tablespoons")).toBe("tbsp");
    expect(normalizeUnit("teaspoons")).toBe("tsp");
    expect(normalizeUnit("pints")).toBe("pint");
    expect(normalizeUnit("quarts")).toBe("quart");
    expect(normalizeUnit("gallons")).toBe("gallon");
  });

  it("distinguishes the T/t shorthand, which is case sensitive", () => {
    expect(normalizeUnit("T")).toBe("tbsp");
    expect(normalizeUnit("t")).toBe("tsp");
    expect(normalizeUnit("Tbsp")).toBe("tbsp");
  });

  it("normalizes fluid ounces and packaging units", () => {
    expect(normalizeUnit("fl oz")).toBe("fl_oz");
    expect(normalizeUnit("fl_oz")).toBe("fl_oz");
    expect(normalizeUnit("fl. oz")).toBe("fl_oz");
    expect(normalizeUnit("fluid ounces")).toBe("fl_oz");
    expect(normalizeUnit("cans")).toBe("can");
    expect(unitFamily("dozen")).toBe("count");
    expect(unitFamily("count")).toBe("count");
    expect(unitFamily("can")).toBeNull();
    expect(unitFamily(null)).toBeNull();
  });

  it("canonicalUnit keeps unknown units as a singular lowercase name", () => {
    expect(canonicalUnit("cups")).toBe("cup");
    expect(canonicalUnit("Handfuls")).toBe("handful");
    expect(canonicalUnit("big  Pinches")).toBe("big pinch");
    expect(canonicalUnit("3 cups")).toBeNull();
    expect(canonicalUnit("")).toBe("count");
  });
});

describe("convert", () => {
  it("returns the quantity for identical units and treats no unit as a plain count", () => {
    const { ctx } = makeTestCtx();
    expect(convert(ctx, 2.5, "lb", "lb")).toBe(2.5);
    expect(convert(ctx, 3, null, null)).toBe(3);
    expect(convert(ctx, 3, null, "count")).toBe(3);
    expect(convert(ctx, 3, "", null)).toBe(3);
    expect(convert(ctx, 3, null, "g")).toBeNull();
    expect(convert(ctx, 3, "g", null)).toBeNull();
  });

  it("converts within mass, volume and count families", () => {
    const { ctx } = makeTestCtx();
    expect(convert(ctx, 1, "lb", "g")).toBeCloseTo(LB_IN_G, 9);
    expect(convert(ctx, 1, "kg", "g")).toBe(1000);
    expect(convert(ctx, 1, "cup", "ml")).toBeCloseTo(236.5882365, 9);
    expect(convert(ctx, 1, "tbsp", "tsp")).toBeCloseTo(3, 9);
    expect(convert(ctx, 1, "pint", "fl oz")).toBeCloseTo(16, 9);
    expect(convert(ctx, 1, "gallon", "quart")).toBeCloseTo(4, 9);
    expect(convert(ctx, 1, "dozen", "count")).toBe(12);
    expect(convert(ctx, 1, "count", "dozen")).toBeCloseTo(1 / 12, 12);
    expect(convert(ctx, 2, "large", "count")).toBe(2);
    expect(convert(ctx, 1, "dozen", "large")).toBe(12);
  });

  it("never guesses across families", () => {
    const { ctx } = makeTestCtx();
    const id = custom(ctx, "Mystery");
    for (const ingredientId of [undefined, id]) {
      expect(convert(ctx, 1, "lb", "ml", ingredientId)).toBeNull();
      expect(convert(ctx, 1, "cup", "g", ingredientId)).toBeNull();
      expect(convert(ctx, 1, "can", "count", ingredientId)).toBeNull();
      expect(convert(ctx, 3, "large", "g", ingredientId)).toBeNull();
    }
  });
});

describe("measures", () => {
  it("convert through grams in both directions and chain through a built-in family", () => {
    const { ctx } = makeTestCtx();
    const tomatoes = custom(ctx, "Canned tomatoes");
    const other = custom(ctx, "Other");
    setMeasure(ctx, tomatoes, "can", { grams: 14.5 * OZ_IN_G });

    expect(convert(ctx, 2, "can", "oz", tomatoes)).toBeCloseTo(29, 9);
    expect(convert(ctx, 1, "oz", "can", tomatoes)).toBeCloseTo(1 / 14.5, 12);
    expect(convert(ctx, 1, "can", "lb", tomatoes)).toBeCloseTo((14.5 * OZ_IN_G) / LB_IN_G, 9);
    expect(convert(ctx, 1, "can", "g", tomatoes)).toBeCloseTo(14.5 * OZ_IN_G, 9);
    // Measures belong to one ingredient.
    expect(convert(ctx, 1, "can", "lb", other)).toBeNull();
    expect(convert(ctx, 1, "can", "lb")).toBeNull();
  });

  it("a volume measure defines the density, so every volume unit converts", () => {
    const { ctx } = makeTestCtx();
    const spinach = custom(ctx, "Baby spinach");
    expect(convert(ctx, 1, "cup", "g", spinach)).toBeNull();

    setMeasure(ctx, spinach, "cup", { grams: 30 });

    expect(convert(ctx, 3, "cup", "g", spinach)).toBe(90);
    expect(convert(ctx, 1, "tbsp", "g", spinach)).toBeCloseTo((30 * 14.78676478125) / 236.5882365, 9);
    expect(convert(ctx, 1, "oz", "cup", spinach)).toBeCloseTo(OZ_IN_G / 30, 9);
    expect(convert(ctx, 1, "pint", "cup", spinach)).toBeCloseTo(2, 9);
  });

  it("a count measure sets what a plain count weighs", () => {
    const { ctx } = makeTestCtx();
    const chicken = custom(ctx, "Chicken breast");
    setMeasure(ctx, chicken, "count", { grams: 8 * OZ_IN_G });

    expect(convert(ctx, 2, "count", "lb", chicken)).toBeCloseTo(1, 9);
    expect(convert(ctx, 2, null, "oz", chicken)).toBeCloseTo(16, 9);
    expect(convert(ctx, 1, "lb", "count", chicken)).toBeCloseTo(2, 9);
    expect(convert(ctx, 1, "dozen", "oz", chicken)).toBeCloseTo(96, 9);
    // A size with no measure of its own weighs what a plain count does.
    expect(convert(ctx, 1, "large", "oz", chicken)).toBeCloseTo(8, 9);
  });

  it("list, update and delete measures; a unit can be new", () => {
    const { ctx } = makeTestCtx();
    const id = custom(ctx, "Parsley");

    expect(listMeasures(ctx, id)).toEqual([]);
    const created = setMeasure(ctx, id, "Bunches", { grams: 40, note: "supermarket bunch" });
    expect(created).toMatchObject({ unit: "bunch", grams: 40, source: "user", estimated: false, note: "supermarket bunch" });

    const updated = setMeasure(ctx, id, "bunch", { grams: 50 });
    expect(updated.grams).toBe(50);
    expect(updated.note).toBe("supermarket bunch");
    expect(listMeasures(ctx, id)).toHaveLength(1);

    deleteMeasure(ctx, id, "bunch");
    expect(listMeasures(ctx, id)).toEqual([]);
    expect(convert(ctx, 1, "bunch", "g", id)).toBeNull();
    expectAppError(() => deleteMeasure(ctx, id, "bunch"), "not_found");
  });

  it("rejects mass units, a dozen, bad grams and unknown ingredients", () => {
    const { ctx } = makeTestCtx();
    const id = custom(ctx, "Parsley");
    expectAppError(() => setMeasure(ctx, id, "oz", { grams: 28 }), "validation");
    expectAppError(() => setMeasure(ctx, id, "kg", { grams: 1000 }), "validation");
    expectAppError(() => setMeasure(ctx, id, "dozen", { grams: 500 }), "validation");
    expectAppError(() => setMeasure(ctx, id, "cup", { grams: 0 }), "validation");
    expectAppError(() => setMeasure(ctx, id, "cup", { grams: Number.NaN }), "validation");
    expectAppError(() => setMeasure(ctx, id, "2 cups!", { grams: 30 }), "validation");
    expectAppError(() => setMeasure(ctx, "ing_missing", "cup", { grams: 30 }), "not_found");
  });
});

describe("unit validation", () => {
  it("accepts built-in units, sizes and plural spellings", () => {
    const { ctx } = makeTestCtx();
    const id = custom(ctx, "Parsley");
    expect(validateUnit(ctx, id, "Tbsp")).toBe("tbsp");
    expect(validateUnit(ctx, id, "pounds")).toBe("lb");
    expect(validateUnit(ctx, id, "large")).toBe("large");
    expect(validateUnit(ctx, id, "")).toBe("count");
    expect(validateUnit(ctx, id, null)).toBeNull();
    expect(validateUnit(ctx, id, undefined)).toBeNull();
  });

  it("accepts a valid unit that cannot convert (cup with no density)", () => {
    const { ctx } = makeTestCtx();
    const id = custom(ctx, "Parsley");
    expect(validateUnit(ctx, id, "cups")).toBe("cup");
    expect(convert(ctx, 1, "cup", "g", id)).toBeNull();
  });

  it("rejects an unknown unit with suggestions and a hint, listing every offender at once", () => {
    const { ctx } = makeTestCtx();
    const parsley = custom(ctx, "Parsley");
    const sage = custom(ctx, "Sage");
    setMeasure(ctx, sage, "sprig", { grams: 2 });

    const error = expectAppError(
      () =>
        validateUnits(ctx, [
          { ingredientId: parsley, unit: "handful" },
          { ingredientId: sage, unit: "Handfuls" },
          { ingredientId: sage, unit: "sprigs" },
          { ingredientId: parsley, unit: "handful" },
          { ingredientId: parsley, unit: "tbs" },
        ]),
      "unprocessable",
    );
    const details = error.details as { unresolvedUnits: Array<Record<string, unknown>> };
    expect(details.unresolvedUnits).toHaveLength(2);
    expect(details.unresolvedUnits[0]).toMatchObject({ unit: "handful", ingredientId: parsley, ingredientName: "Parsley" });
    expect(details.unresolvedUnits[1]).toMatchObject({ ingredientId: sage, ingredientName: "Sage" });
    const sageSuggestions = details.unresolvedUnits[1]!.suggestions as string[];
    expect(sageSuggestions).toContain("sprig");
    expect(sageSuggestions.length).toBeGreaterThan(1);
    expect(String(details.unresolvedUnits[0]!.hint)).toContain("measure");
    expect(String(details.unresolvedUnits[0]!.hint)).toContain(`/ingredients/${parsley}/measures/handful`);
  });

  it("accepts a unit once the ingredient has a measure for it", () => {
    const { ctx } = makeTestCtx();
    const id = custom(ctx, "Parsley");
    expectAppError(() => validateUnit(ctx, id, "handful"), "unprocessable");
    setMeasure(ctx, id, "handful", { grams: 25 });
    expect(validateUnit(ctx, id, "Handfuls")).toBe("handful");
  });
});
