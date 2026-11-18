import { describe, expect, it } from "vitest";
import { formatGrams, formatNutrient, formatWhole, lineDetail, lineReason, partialLabel, type NutritionLine } from "./nutrition";

describe("formatWhole", () => {
  it("rounds and dashes", () => {
    expect(formatWhole(1239.6)).toBe("1240");
    expect(formatWhole(0)).toBe("0");
    expect(formatWhole(null)).toBe("—");
  });
});

describe("formatGrams", () => {
  it.each([
    [2.46, "2.5"],
    [3, "3"],
    [0.04, "0"],
    [9.96, "10"],
    [24.4, "24"],
    [null, "—"],
  ])("%s -> %s", (value, text) => {
    expect(formatGrams(value)).toBe(text);
  });
});

describe("formatNutrient", () => {
  it("adds the unit for each nutrient", () => {
    expect(formatNutrient(320.2, "calories")).toBe("320 kcal");
    expect(formatNutrient(24.4, "protein")).toBe("24 g");
    expect(formatNutrient(4.25, "fiber")).toBe("4.3 g");
    expect(formatNutrient(480.4, "sodium")).toBe("480 mg");
  });
  it("shows a bare dash for a missing value", () => {
    expect(formatNutrient(null, "sodium")).toBe("—");
  });
});

describe("partialLabel", () => {
  it("is null when nothing is missing", () => {
    expect(partialLabel(5, 0)).toBeNull();
    expect(partialLabel(0, 0)).toBeNull();
  });
  it("counts counted against all non-optional lines", () => {
    expect(partialLabel(3, 2)).toBe("Partial: 3 of 5 ingredients counted");
    expect(partialLabel(0, 1)).toBe("Partial: 0 of 1 ingredient counted");
  });
});

describe("lineReason", () => {
  it("names why a line is blank", () => {
    expect(lineReason({ status: "ok", unit: "cup" })).toBeNull();
    expect(lineReason({ status: "optional", unit: null })).toBe("Optional, not counted");
    expect(lineReason({ status: "no_quantity", unit: null })).toBe("No amount, not counted");
    expect(lineReason({ status: "no_match", unit: "g" })).toBe("No matching food");
    expect(lineReason({ status: "no_conversion", unit: "clove" })).toBe("Can't convert clove to grams");
    expect(lineReason({ status: "no_conversion", unit: null })).toBe("Can't convert to grams");
  });
});

describe("lineDetail", () => {
  const base: NutritionLine = {
    recipeIngredientId: "ri_1",
    ingredientId: "ing_1",
    name: "Onion",
    qty: 1,
    qtyMax: null,
    unit: null,
    grams: null,
    food: null,
    nutrients: null,
    status: "ok",
  };
  it("shows grams and the matched food for a counted line", () => {
    expect(lineDetail({ ...base, grams: 110, food: { fdcId: 1, description: "Onions, raw" } })).toBe("110 g · Onions, raw");
  });
  it("shows the reason, then the food, for a blank line", () => {
    expect(
      lineDetail({ ...base, status: "no_conversion", unit: "bunch", food: { fdcId: 2, description: "Parsley, fresh" } }),
    ).toBe("Can't convert bunch to grams · Parsley, fresh");
    expect(lineDetail({ ...base, status: "no_match" })).toBe("No matching food");
  });
});
