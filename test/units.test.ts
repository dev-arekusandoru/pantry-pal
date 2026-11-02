import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { createIngredient, listIngredients } from "../src/services/ingredients.js";
import {
  convert,
  createConversion,
  deleteConversion,
  listConversions,
  normalizeUnit,
  unitFamily,
} from "../src/services/units.js";
import { makeTestCtx } from "./helpers.js";

const OZ_IN_G = 28.349523125;
const LB_IN_G = 453.59237;

function expectAppError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`Expected an AppError with code ${code}`);
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
    expect(normalizeUnit("fl. oz")).toBe("fl_oz");
    expect(normalizeUnit("fluid ounces")).toBe("fl_oz");
    expect(normalizeUnit("cans")).toBe("can");
    expect(normalizeUnit("jars")).toBe("jar");
    expect(normalizeUnit("bunches")).toBe("bunch");
    expect(normalizeUnit("boxes")).toBe("box");
    expect(normalizeUnit("pkg")).toBe("package");
    expect(normalizeUnit("packages")).toBe("package");
    expect(normalizeUnit("cloves")).toBe("clove");
    expect(normalizeUnit("slices")).toBe("slice");
    expect(normalizeUnit("fillets")).toBe("fillet");
    expect(normalizeUnit("sticks")).toBe("stick");
    expect(normalizeUnit("dozen")).toBe("dozen");
  });

  it("maps count synonyms and the empty string to count", () => {
    expect(normalizeUnit("each")).toBe("count");
    expect(normalizeUnit("whole")).toBe("count");
    expect(normalizeUnit("ea")).toBe("count");
    expect(normalizeUnit("x")).toBe("count");
    expect(normalizeUnit("")).toBe("count");
    expect(normalizeUnit("   ")).toBe("count");
  });

  it("keeps null for absent units and rejects unknown ones", () => {
    expect(normalizeUnit(null)).toBeNull();
    expect(normalizeUnit(undefined)).toBeNull();
    expect(normalizeUnit("smidgen")).toBeNull();
  });
});

describe("unitFamily", () => {
  it("classifies units into the built-in families", () => {
    expect(unitFamily("lb")).toBe("mass");
    expect(unitFamily("kg")).toBe("mass");
    expect(unitFamily("cup")).toBe("volume");
    expect(unitFamily("fl oz")).toBe("volume");
    expect(unitFamily("dozen")).toBe("count");
    expect(unitFamily("count")).toBe("count");
    expect(unitFamily("can")).toBeNull();
    expect(unitFamily(null)).toBeNull();
  });
});

describe("convert", () => {
  it("returns the quantity for identical units and for two null units", () => {
    const { ctx } = makeTestCtx();
    expect(convert(ctx, 2.5, "lb", "lb")).toBe(2.5);
    expect(convert(ctx, 3, null, null)).toBe(3);
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
  });

  it("never guesses across families", () => {
    const { ctx } = makeTestCtx();
    expect(convert(ctx, 1, "lb", "ml")).toBeNull();
    expect(convert(ctx, 1, "cup", "g")).toBeNull();
    expect(convert(ctx, 1, "can", "count")).toBeNull();
  });

  it("chains a per-ingredient packaging conversion through a built-in family", () => {
    const { ctx } = makeTestCtx();
    const ingredient = createIngredient(ctx, { name: "Canned tomatoes" });
    createConversion(ctx, {
      ingredientId: ingredient.id,
      fromUnit: "can",
      toUnit: "oz",
      factor: 14.5,
    });

    const lb = convert(ctx, 1, "can", "lb", ingredient.id);
    expect(lb).toBeCloseTo((14.5 * OZ_IN_G) / LB_IN_G, 9);
    expect(convert(ctx, 1, "oz", "can", ingredient.id)).toBeCloseTo(1 / 14.5, 12);
    // Not comparable for an ingredient without its own conversion.
    const other = createIngredient(ctx, { name: "Canned beans" });
    expect(convert(ctx, 1, "can", "lb", other.id)).toBeNull();
  });

  it("uses household-global conversions when the ingredient has none", () => {
    const { ctx } = makeTestCtx();
    createConversion(ctx, { fromUnit: "can", toUnit: "oz", factor: 12 });
    expect(convert(ctx, 2, "can", "oz")).toBe(24);
    expect(convert(ctx, 1, "oz", "can")).toBeCloseTo(1 / 12, 12);
    expect(convert(ctx, 1, "can", "lb")).toBeCloseTo((12 * OZ_IN_G) / LB_IN_G, 9);
  });

  it("prefers the per-ingredient conversion over the global one", () => {
    const { ctx } = makeTestCtx();
    const ingredient = createIngredient(ctx, { name: "Tomato paste" });
    createConversion(ctx, { fromUnit: "can", toUnit: "oz", factor: 12 });
    createConversion(ctx, {
      ingredientId: ingredient.id,
      fromUnit: "can",
      toUnit: "oz",
      factor: 6,
    });
    expect(convert(ctx, 1, "can", "oz", ingredient.id)).toBe(6);
    expect(convert(ctx, 1, "can", "oz")).toBe(12);
  });

  it("supports the inverse of a stored conversion", () => {
    const { ctx } = makeTestCtx();
    createConversion(ctx, { fromUnit: "dozen", toUnit: "count", factor: 12 });
    expect(convert(ctx, 24, "count", "dozen")).toBeCloseTo(2, 12);
  });
});

describe("conversion rows", () => {
  it("normalizes units, lists and deletes rows", () => {
    const { ctx } = makeTestCtx();
    const ingredient = createIngredient(ctx, { name: "Coconut milk" });
    const created = createConversion(ctx, {
      ingredientId: ingredient.id,
      fromUnit: "Cans",
      toUnit: "fl oz",
      factor: 13.5,
    });
    expect(created.fromUnit).toBe("can");
    expect(created.toUnit).toBe("fl_oz");

    const list = listConversions(ctx, { ingredientId: ingredient.id });
    expect(list).toHaveLength(1);
    expect(listConversions(ctx)).toHaveLength(1);

    deleteConversion(ctx, created.id);
    expect(listConversions(ctx)).toHaveLength(0);
    expect(convert(ctx, 1, "can", "oz", ingredient.id)).toBeNull();
    expectAppError(() => deleteConversion(ctx, created.id), "not_found");
  });

  it("rejects duplicates (including global rows where NULLs are distinct in SQL)", () => {
    const { ctx } = makeTestCtx();
    createConversion(ctx, { fromUnit: "can", toUnit: "oz", factor: 12 });
    expectAppError(
      () => createConversion(ctx, { fromUnit: "cans", toUnit: "ounces", factor: 10 }),
      "conflict",
    );
  });

  it("rejects identical units, unknown units and unknown ingredients", () => {
    const { ctx } = makeTestCtx();
    expectAppError(
      () => createConversion(ctx, { fromUnit: "cup", toUnit: "cup", factor: 1 }),
      "validation",
    );
    expectAppError(
      () => createConversion(ctx, { fromUnit: "blorp", toUnit: "oz", factor: 1 }),
      "validation",
    );
    expectAppError(
      () => createConversion(ctx, { fromUnit: "cup", toUnit: "oz", factor: 0 }),
      "validation",
    );
    expectAppError(
      () =>
        createConversion(ctx, {
          ingredientId: "ing_missing",
          fromUnit: "can",
          toUnit: "oz",
          factor: 12,
        }),
      "not_found",
    );
    expect(listIngredients(ctx)).toHaveLength(0);
  });
});
