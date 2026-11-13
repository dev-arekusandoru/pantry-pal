import { describe, expect, it } from "vitest";
import { aggregateDex } from "./dex";
import type { DexIngredient, DexRecipe } from "./dex";
import type { DoneCook } from "@/game/history";

const tomato: DexIngredient = { id: "tomato", name: "Tomato", category: "produce", imageUrl: null };
const ingredient = { ...tomato };
const cooks: DoneCook[] = [
  { recipeId: "r1", recipeTitle: "Soup", cookDate: "2026-11-01" },
  { recipeId: "r1", recipeTitle: "Soup", cookDate: "2026-11-02" },
  { recipeId: "r2", recipeTitle: "Toast", cookDate: "2026-11-03" },
];
const recipes: DexRecipe[] = [
  { id: "r1", title: "Soup", ingredients: [{ ingredientId: "tomato", ingredient }] as DexRecipe["ingredients"] },
  { id: "r2", title: "Toast", ingredients: [{ ingredientId: "tomato", ingredient }] as DexRecipe["ingredients"] },
];

describe("aggregateDex", () => {
  it("counts each cooked recipe occurrence and lists unique recipes", () => {
    expect(aggregateDex([tomato], cooks, recipes)).toEqual([
      { ...tomato, firstCooked: "2026-11-01", times: 3, recipes: ["Soup", "Toast"] },
    ]);
  });
  it("ignores recipes missing from fetched details", () => {
    expect(aggregateDex([], cooks, [])).toEqual([]);
  });
});
