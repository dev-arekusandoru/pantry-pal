import type { DoneCook } from "@/game/history";
import type { components } from "@/api";

export type DexIngredient = Pick<components["schemas"]["Ingredient"], "id" | "name" | "category" | "imageUrl">;
export type DexRecipe = { id: string; title: string; ingredients: components["schemas"]["RecipeIngredient"][] };
export type DexEntry = DexIngredient & { firstCooked: string; times: number; recipes: string[] };

export function aggregateDex(catalog: DexIngredient[], cooks: DoneCook[], recipes: DexRecipe[]): DexEntry[] {
  const result = new Map<string, DexEntry>();
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  for (const cook of cooks) {
    const recipe = byId.get(cook.recipeId);
    if (!recipe) continue;
    for (const line of recipe.ingredients) {
      const source = catalog.find((item) => item.id === line.ingredientId) ?? line.ingredient;
      const entry = result.get(source.id);
      if (entry) {
        entry.times++;
        if (!entry.recipes.includes(cook.recipeTitle)) entry.recipes.push(cook.recipeTitle);
      } else {
        result.set(source.id, { id: source.id, name: source.name, category: source.category, imageUrl: source.imageUrl, firstCooked: cook.cookDate, times: 1, recipes: [cook.recipeTitle] });
      }
    }
  }
  return [...result.values()];
}
