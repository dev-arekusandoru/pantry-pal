import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { client, qk, unwrap } from "@/api";
import { localDate } from "../recipe/lib";

export type FinishInput =
  /** Complete a planned cook event. */
  | { kind: "planned"; cookEventId: string; servings: number }
  /** Record and complete a cook that is not on the plan. */
  | { kind: "adhoc"; recipeId: string; servings: number };

/** Cooks move pantry stock and plan status, so refresh everything that shows either. */
function invalidateCookResults(queryClient: QueryClient): Promise<unknown> {
  return Promise.all(
    [qk.pantry, qk.plans, qk.prepTasks, qk.cookEvents, qk.recipes, qk.shoppingLists].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}

/**
 * Finishing a cook decrements the pantry and completes planned meals, so refresh
 * everything that shows them. Errors are handled by the caller: a stale
 * `cookEvent` id falls back to an ad-hoc cook instead of failing.
 */
export function useFinishCook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FinishInput) =>
      input.kind === "planned"
        ? unwrap(
            client.POST("/cook-events/{id}/complete", {
              params: { path: { id: input.cookEventId } },
              body: { actualServings: input.servings },
            }),
          )
        : unwrap(
            client.POST("/cook-events", {
              body: { recipeId: input.recipeId, servings: input.servings, cookDate: localDate(), complete: true },
            }),
          ),
    meta: { silent: true },
    onSuccess: () => invalidateCookResults(queryClient),
  });
}

/** Undo a completed cook from the week or the "mark cooked" toast. */
export function useUndoCook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cookEventId: string) =>
      unwrap(
        client.POST("/cook-events/{id}/undo", { params: { path: { id: cookEventId } } }),
      ),
    onSuccess: () => invalidateCookResults(queryClient),
  });
}
