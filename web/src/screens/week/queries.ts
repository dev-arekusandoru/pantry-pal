import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, client, qk, unwrap } from "@/api";
import { householdQueryOptions, weekStartsOnOf } from "@/screens/settings/queries";
import { localToday, weekStartFor } from "./dates";
import { nudgeWindow, type AvailabilityLine, type MealType, type PlanView } from "./model";

/** Cache key for one week's plan (the API looks plans up by id or weekStart). */
const planKey = (weekStart: string) => [...qk.plans, weekStart] as const;

/** The plan for the given week, or `null` when none exists yet (the API answers 404). */
export function usePlan(weekStart: string) {
  return useQuery({
    queryKey: planKey(weekStart),
    // Paging keeps the last week's cards on screen while the next one loads.
    // Swapping in the loading skeleton collapsed the page from ~3000px to ~780px,
    // which made the browser clamp the scroll position to the top.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<PlanView | null> => {
      try {
        return await unwrap(
          client.GET("/plans/{idOrWeekStart}", { params: { path: { idOrWeekStart: weekStart } } }),
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}

/** Photos, slugs and times for recipes shown on the week (plan slots only carry id and title). */
export function useRecipeIndex() {
  return useQuery({
    queryKey: [...qk.recipes, "week-index"],
    queryFn: () => unwrap(client.GET("/recipes", { params: { query: { limit: 200 } } })),
    staleTime: 5 * 60_000,
    select: (data) => new Map(data.items.map((r) => [r.id, r])),
  });
}

export function usePrepTasks(today: string) {
  const { from, to } = nudgeWindow(today);
  return useQuery({
    queryKey: [...qk.prepTasks, "nudge", from, to],
    queryFn: () => unwrap(client.GET("/prep-tasks", { params: { query: { from, to } } })),
    select: (data) => data.items,
  });
}

export function useCompletePrepTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(client.POST("/prep-tasks/{id}/complete", { params: { path: { id } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.prepTasks });
      void queryClient.invalidateQueries({ queryKey: qk.plans });
    },
  });
}

export interface SwapInput {
  /** Existing slot, or null for an empty day where the server creates one. */
  slot: { id: string } | { date: string; mealType: MealType };
  recipeId: string;
  scope: "this" | "with_leftovers";
}

export function useSwapMeal(planId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slot, recipeId, scope }: SwapInput) =>
      unwrap(
        client.POST("/plans/{id}/swap", {
          params: { path: { id: planId } },
          body: "id" in slot ? { slotId: slot.id, recipeId, scope } : { ...slot, recipeId, scope },
        }),
      ),
    onSuccess: ({ plan }) => {
      queryClient.setQueryData(planKey(plan.weekStart), plan);
      // Shopping lists carry the stale flag; availability counts planned demand; cooks changed.
      for (const root of [qk.shoppingLists, qk.pantry, qk.cookEvents]) {
        void queryClient.invalidateQueries({ queryKey: root });
      }
    },
  });
}

/** Creates an empty plan for the current week, aligned to the household's week start. */
export function useStartEmptyWeek() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const household = await queryClient.fetchQuery(householdQueryOptions());
      const weekStart = weekStartFor(localToday(), weekStartsOnOf(household));
      return unwrap(client.POST("/plans", { body: { weekStart, status: "active" } }));
    },
    onSuccess: (plan) => {
      queryClient.setQueryData(planKey(plan.weekStart), plan);
      void queryClient.invalidateQueries({ queryKey: qk.plans });
    },
    onError: () => {
      // A 409 means the plan already exists (server and browser disagree on today); show it.
      void queryClient.invalidateQueries({ queryKey: qk.plans });
    },
  });
}

/** Recipes for the swap picker, filtered by meal type and search on the server. */
export function usePickerRecipes(mealType: MealType, search: string) {
  const query = search.trim();
  return useQuery({
    queryKey: [...qk.recipes, "picker", mealType, query],
    queryFn: () =>
      unwrap(
        client.GET("/recipes", {
          params: { query: { mealType, limit: 100, ...(query ? { query } : {}) } },
        }),
      ),
    placeholderData: keepPreviousData,
    select: (data) => data.items.filter((r) => r.status !== "never" && r.status !== "archived"),
  });
}

/** Stock against planned demand per ingredient, for "the pantry already covers" counts. */
export function useAvailability(enabled: boolean) {
  return useQuery({
    queryKey: [...qk.pantry, "availability"],
    queryFn: () => unwrap(client.GET("/pantry/availability")),
    enabled,
    select: (data): Map<string, AvailabilityLine> => new Map(data.items.map((l) => [l.ingredientId, l])),
  });
}

export function useRecipeIngredients(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: [...qk.recipes, "ingredients", slug],
    queryFn: () => unwrap(client.GET("/recipes/{idOrSlug}", { params: { path: { idOrSlug: slug } } })),
    enabled,
    staleTime: 5 * 60_000,
    select: (recipe) => recipe.ingredients,
  });
}
