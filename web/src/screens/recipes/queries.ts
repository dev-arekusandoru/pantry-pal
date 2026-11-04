import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { client, qk, unwrap } from "@/api";

export const MEAL_FILTERS = ["all", "breakfast", "lunch", "dinner", "snack", "dessert"] as const;
export type MealFilter = (typeof MEAL_FILTERS)[number];

/** Recipes the household has put aside stay out of the box. */
const HIDDEN_STATUSES = ["archived", "never"];

export function useRecipeBox(meal: MealFilter, query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: [...qk.recipes, "list", { meal, q }],
    queryFn: () =>
      unwrap(
        client.GET("/recipes", {
          params: {
            query: {
              limit: 200,
              ...(meal !== "all" ? { mealType: meal } : {}),
              ...(q !== "" ? { query: q } : {}),
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
    select: (d) => d.items.filter((r) => !HIDDEN_STATUSES.includes(r.status)),
  });
}
