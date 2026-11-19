import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { client, qk, unwrap, type components } from "@/api";
import { conflictingIngredient, type IngredientCategory, type IngredientPick } from "./refs";

export type FindResult = components["schemas"]["FindIngredientsResult"];
export type FoundIngredient = FindResult["ingredients"][number];
export type FoundFood = FindResult["foods"][number];
export type ReviewItem = components["schemas"]["IngredientReviewItem"];
export type IngredientSuggestion = components["schemas"]["IngredientSuggestion"];
export type IngredientView = components["schemas"]["IngredientView"];
export type IngredientDetail = components["schemas"]["IngredientDetail"];
/** What the server accepts to name one ingredient (main or alternative). */
export type IngredientRefBody = components["schemas"]["IngredientRef"];

/** A value that follows `value` after it stops changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** The household's ingredients and the USDA foods that match `query`. */
export function useFindIngredients(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: [...qk.ingredients, "find", q],
    queryFn: () => unwrap(client.GET("/ingredients/find", { params: { query: { query: q, limit: 8 } } })),
    enabled: q !== "",
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export type NewIngredient =
  | { kind: "food"; fdcId: number; name: string; category: IngredientCategory }
  | { kind: "custom"; name: string; category: IngredientCategory };

/**
 * Create an ingredient from a USDA food, or a custom one. A food the household
 * already has an ingredient for resolves to that ingredient. Other failures
 * (naming rules, a taken name) are thrown for the form to show.
 */
export function useCreateIngredient() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { silent: true },
    mutationFn: async (input: NewIngredient): Promise<IngredientPick> => {
      const body =
        input.kind === "food"
          ? { fdcId: input.fdcId, name: input.name, category: input.category }
          : { custom: true, name: input.name, category: input.category };
      try {
        const created = await unwrap(client.POST("/ingredients", { body }));
        return { id: created.id, name: created.name };
      } catch (error) {
        const existing = input.kind === "food" ? conflictingIngredient(error) : null;
        if (existing !== null) return existing;
        throw error;
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.ingredients }),
  });
}

/** Name of an ingredient by id, for a food the household already has an ingredient for. */
export async function fetchIngredientPick(id: string): Promise<IngredientPick> {
  const ingredient = await unwrap(client.GET("/ingredients/{id}", { params: { path: { id } } }));
  return { id: ingredient.id, name: ingredient.name };
}

export function useIngredient(id: string) {
  return useQuery({
    queryKey: [...qk.ingredients, "detail", id],
    queryFn: () => unwrap(client.GET("/ingredients/{id}", { params: { path: { id } } })),
  });
}

/** Ingredients that need a look: unlinked, oddly named, or custom and not yet accepted. */
export function useReviewList() {
  return useQuery({
    queryKey: [...qk.ingredients, "review"],
    queryFn: async () => (await unwrap(client.GET("/ingredients/review"))).items,
    staleTime: 60_000,
  });
}

/** Everything that shows ingredient names or food links refetches after a review action. */
function useRefreshIngredients() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [qk.ingredients, qk.recipes, qk.pantry, qk.shoppingLists, qk.nutrition].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
}

export function useLinkFood() {
  const refresh = useRefreshIngredients();
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: { ingredientId: string; fdcId: number }) =>
      unwrap(
        client.PUT("/ingredients/{id}/nutrition", {
          params: { path: { id: input.ingredientId } },
          body: { mode: "manual", fdcId: input.fdcId },
        }),
      ),
    onSuccess: refresh,
  });
}

/** Choose which portion of the linked food a plain count means; null clears it. */
export function useSetDefaultPortion() {
  const refresh = useRefreshIngredients();
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: { ingredientId: string; defaultPortion: string | null }) =>
      unwrap(
        client.PATCH("/ingredients/{id}", {
          params: { path: { id: input.ingredientId } },
          body: { defaultPortion: input.defaultPortion },
        }),
      ),
    onSuccess: refresh,
  });
}

export function useAcceptIngredient() {
  const refresh = useRefreshIngredients();
  return useMutation({
    meta: { silent: true },
    mutationFn: (ingredientId: string) =>
      unwrap(client.POST("/ingredients/{id}/review", { params: { path: { id: ingredientId } } })),
    onSuccess: refresh,
  });
}

export function useMergeIngredient() {
  const refresh = useRefreshIngredients();
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: { ingredientId: string; intoId: string }) =>
      unwrap(
        client.POST("/ingredients/{id}/merge", {
          params: { path: { id: input.ingredientId } },
          body: { intoId: input.intoId },
        }),
      ),
    onSuccess: refresh,
  });
}

export function useSplitIngredient() {
  const refresh = useRefreshIngredients();
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: { ingredientId: string; main: IngredientPick; alternatives: IngredientPick[] }) =>
      unwrap(
        client.POST("/ingredients/{id}/split", {
          params: { path: { id: input.ingredientId } },
          body: {
            main: { ingredientId: input.main.id },
            alternatives: input.alternatives.map((alternative) => ({ ingredientId: alternative.id })),
          },
        }),
      ),
    onSuccess: refresh,
  });
}

/** Every ingredient (not archived), with its aliases and linked food: the library list. */
export function useIngredientLibrary() {
  return useQuery({
    queryKey: [...qk.ingredients, "list"] as const,
    queryFn: async () => (await unwrap(client.GET("/ingredients"))).items,
  });
}

/** How often each ingredient is used. An ingredient that is not listed is unused. */
export function useUsageCounts() {
  return useQuery({
    queryKey: [...qk.ingredients, "usage"] as const,
    queryFn: async () => (await unwrap(client.GET("/ingredients/usage"))).items,
  });
}

export type UpdateIngredientBody = components["schemas"]["UpdateIngredient"];

/** Patch any ingredient fields. Naming problems and name clashes are thrown for the form to show. */
export function useUpdateIngredient() {
  const refresh = useRefreshIngredients();
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: { ingredientId: string; changes: UpdateIngredientBody }) =>
      unwrap(client.PATCH("/ingredients/{id}", { params: { path: { id: input.ingredientId } }, body: input.changes })),
    onSuccess: refresh,
  });
}

export function useAddAlias() {
  const refresh = useRefreshIngredients();
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: { ingredientId: string; alias: string }) =>
      unwrap(
        client.POST("/ingredients/{id}/aliases", {
          params: { path: { id: input.ingredientId } },
          body: { alias: input.alias },
        }),
      ),
    onSuccess: refresh,
  });
}

export function useRemoveAlias() {
  const refresh = useRefreshIngredients();
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: { ingredientId: string; aliasId: string }) =>
      unwrap(
        client.DELETE("/ingredients/{id}/aliases/{aliasId}", {
          params: { path: { id: input.ingredientId, aliasId: input.aliasId } },
        }),
      ),
    onSuccess: refresh,
  });
}

export function useArchiveIngredient() {
  const refresh = useRefreshIngredients();
  return useMutation({
    meta: { silent: true },
    mutationFn: (ingredientId: string) =>
      unwrap(client.DELETE("/ingredients/{id}", { params: { path: { id: ingredientId } } })),
    onSuccess: refresh,
  });
}
