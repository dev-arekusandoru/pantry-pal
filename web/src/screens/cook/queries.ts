import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client, qk, unwrap } from "@/api";
import { localDate } from "../recipe/lib";

export type FinishInput =
  /** Complete a planned cook event. */
  | { kind: "planned"; cookEventId: string; servings: number }
  /** Record and complete a cook that is not on the plan. */
  | { kind: "adhoc"; recipeId: string; servings: number };

/** Finishing a cook decrements the pantry and completes planned meals, so refresh everything that shows them. */
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
    onSuccess: () =>
      Promise.all(
        [qk.pantry, qk.plans, qk.prepTasks, qk.cookEvents, qk.recipes].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
}
