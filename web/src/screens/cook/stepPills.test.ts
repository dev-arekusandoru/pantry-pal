import { describe, expect, it } from "vitest";
import type { RecipeStepLink } from "../recipe/lib";
import { stepPillRows } from "./stepPills";

function link(overrides: Partial<RecipeStepLink>): RecipeStepLink {
  return {
    id: "rsi_1",
    stepId: "rs_1",
    recipeIngredientId: "ri_1",
    qty: null,
    position: 0,
    ingredientId: "ing_1",
    ingredientName: "Flour",
    imageUrl: null,
    unit: "cup",
    prepNote: "sifted",
    ...overrides,
  };
}

const lines = [
  { id: "ri_1", scalingExempt: false },
  { id: "ri_2", scalingExempt: true },
];

describe("stepPillRows", () => {
  it("scales a link qty by the servings factor", () => {
    const scaled = [
      { recipeIngredientId: "ri_1", qty: 4, qtyMax: null, unit: "cup" },
      { recipeIngredientId: "ri_2", qty: 1, qtyMax: null, unit: "tsp" },
    ];
    const pills = stepPillRows(
      [
        link({ qty: 1 }),
        link({ id: "rsi_2", recipeIngredientId: "ri_2", ingredientName: "Salt", unit: "tsp", qty: 1 }),
      ],
      lines,
      scaled,
      8,
      4,
    );
    expect(pills.map((pill) => pill.amount)).toEqual(["2 cups", "1 tsp"]);
  });

  it("uses the scaled whole-line amount when the link qty is null", () => {
    // The scaled endpoint already returns the whole-line amount for these servings.
    const scaled = [{ recipeIngredientId: "ri_1", qty: 6, qtyMax: 8, unit: "cup" }];
    const pills = stepPillRows([link({ qty: null })], lines, scaled, 4, 2);
    expect(pills[0]).toMatchObject({ name: "Flour", amount: "6–8 cups", prepNote: "sifted" });
  });

  it("keeps scaling-exempt links at the written amount", () => {
    const scaled = [{ recipeIngredientId: "ri_2", qty: 1, qtyMax: null, unit: "tsp" }];
    const pills = stepPillRows(
      [link({ recipeIngredientId: "ri_2", ingredientName: "Salt", unit: "tsp", qty: 0.5 })],
      lines,
      scaled,
      8,
      4,
    );
    expect(pills[0]?.amount).toBe("½ tsp");
  });
});
