import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { client, qk, unwrap } from "@/api";
import { ApiError } from "@/api/errors";

/** Hooks shared by the recipe screen and cook mode (same keys, so the cache is shared). */

export function useRecipe(slug: string) {
  return useQuery({
    queryKey: [...qk.recipes, "detail", slug],
    queryFn: () => unwrap(client.GET("/recipes/{idOrSlug}", { params: { path: { idOrSlug: slug } } })),
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

export function useRuleCheck(slug: string) {
  return useQuery({
    queryKey: [...qk.recipes, "check", slug],
    queryFn: () => unwrap(client.GET("/recipes/{idOrSlug}/check", { params: { path: { idOrSlug: slug } } })),
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

/** True for a 404 from any query (used for "recipe not found"). */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
