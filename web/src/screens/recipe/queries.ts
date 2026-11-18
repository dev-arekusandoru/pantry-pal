import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, errorMessage, qk, unwrap } from "@/api";
import { ApiError } from "@/api/errors";
import { toast } from "@/ui";
import { STATUS_PHRASES, type RecipeStatus } from "./status";

/** Hooks shared by the recipe screen and cook mode (same keys, so the cache is shared). */

export function useRecipe(slug: string | undefined) {
  return useQuery({
    queryKey: [...qk.recipes, "detail", slug ?? ""],
    queryFn: () =>
      unwrap(client.GET("/recipes/{idOrSlug}", { params: { path: { idOrSlug: slug ?? "" } } })),
    enabled: slug !== undefined && slug !== "",
  });
}

/** Ingredient quantities scaled to `servings`. Keeps the previous result while a new scale loads. */
export function useScaledIngredients(slug: string, servings: number | undefined) {
  return useQuery({
    queryKey: [...qk.recipes, "scaled", slug, servings],
    queryFn: () =>
      unwrap(
        client.GET("/recipes/{idOrSlug}/scaled", {
          params: { path: { idOrSlug: slug }, query: { servings: servings ?? 1 } },
        }),
      ),
    enabled: servings !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useAvailability() {
  return useQuery({
    queryKey: [...qk.pantry, "availability"],
    queryFn: () => unwrap(client.GET("/pantry/availability", { params: { query: {} } })),
  });
}

/** Planned (not yet cooked) cook events of one recipe. Disabled until the recipe id is known. */
export function usePlannedCooks(recipeId: string | undefined, date?: string) {
  return useQuery({
    queryKey: [...qk.cookEvents, "planned", recipeId, date ?? null],
    queryFn: () =>
      unwrap(
        client.GET("/cook-events", {
          params: {
            query: {
              recipeId: recipeId ?? "",
              status: "planned",
              ...(date !== undefined ? { from: date, to: date } : {}),
            },
          },
        }),
      ),
    enabled: recipeId !== undefined,
    // Cook mode decides on this at Finish; never trust a cached copy from earlier.
    staleTime: 0,
    select: (d) => d.items,
  });
}

/** Move a recipe between statuses; lists and the detail share `qk.recipes`. */
export function useSetRecipeStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { slug: string; status: RecipeStatus }) =>
      unwrap(
        client.POST("/recipes/{idOrSlug}/status", {
          params: { path: { idOrSlug: input.slug } },
          body: { status: input.status },
        }),
      ),
    onSuccess: (res, input) => {
      void queryClient.invalidateQueries({ queryKey: qk.recipes });
      toast.show({ message: `Moved ${res.recipe.title} to ${STATUS_PHRASES[input.status]}` });
    },
  });
}

/** Delete a recipe with no cook history. */
export function useDeleteRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      unwrap(client.DELETE("/recipes/{idOrSlug}", { params: { path: { idOrSlug: slug } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.recipes });
      toast.show({ message: "Recipe deleted" });
    },
    onError: (error) => toast.show({ message: errorMessage(error) }),
  });
}

/** True for a 404 from any query (used for "recipe not found"). */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** Whole-recipe and per-serving nutrition with the per-line breakdown. Shares `qk.recipes`, so recipe edits refresh it. */
export function useRecipeNutrition(slug: string) {
  return useQuery({
    queryKey: [...qk.recipes, "nutrition", slug],
    queryFn: () =>
      unwrap(client.GET("/recipes/{idOrSlug}/nutrition", { params: { path: { idOrSlug: slug } } })),
  });
}

/** USDA food search for the match picker. The dataset ships with the server, so results rarely change. */
export function useFoodSearch(query: string, limit = 15) {
  const q = query.trim();
  return useQuery({
    queryKey: [...qk.nutrition, "foods", q, limit],
    queryFn: () => unwrap(client.GET("/nutrition/foods", { params: { query: { q, limit } } })),
    enabled: q !== "",
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    select: (d) => d.items,
  });
}

export type IngredientNutritionChoice = { mode: "auto" } | { mode: "manual"; fdcId: number | null };

/** Pick the USDA food for an ingredient. It applies to every recipe that uses the ingredient. */
export function useSetIngredientNutrition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ingredientId: string; choice: IngredientNutritionChoice }) =>
      unwrap(
        client.PUT("/ingredients/{id}/nutrition", {
          params: { path: { id: input.ingredientId } },
          body: input.choice,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.recipes });
      void queryClient.invalidateQueries({ queryKey: qk.ingredients });
    },
    onError: (error) => toast.show({ message: errorMessage(error), tone: "error" }),
  });
}
