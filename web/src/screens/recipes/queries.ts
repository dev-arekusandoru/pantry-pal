import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { client, qk, unwrap } from "@/api";
import { filterByStatusView, type StatusView } from "./filter";

export const MEAL_FILTERS = ["all", "breakfast", "lunch", "dinner", "snack", "dessert"] as const;
export type MealFilter = (typeof MEAL_FILTERS)[number];

export function useRecipeBox(view: StatusView, meal: MealFilter, query: string) {
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
    // View switching reuses the same fetch; archived recipes never come back.
    select: (d) => filterByStatusView(d.items, view),
  });
}
