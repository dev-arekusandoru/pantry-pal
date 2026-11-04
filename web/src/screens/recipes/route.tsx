import { createRoute } from "@tanstack/react-router";
import { shellRoute } from "@/app/routes";
import { RecipesScreen } from "./RecipesScreen";
import { MEAL_FILTERS, type MealFilter } from "./queries";

export interface RecipesSearch {
  meal?: Exclude<MealFilter, "all">;
  q?: string;
}

export const recipesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/recipes",
  staticData: { tab: "recipes" },
  // Filters live in the URL so Back from a recipe returns to the same list.
  validateSearch: (search: Record<string, unknown>): RecipesSearch => {
    const meal = MEAL_FILTERS.find((m) => m !== "all" && m === search.meal);
    const q = typeof search.q === "string" && search.q.trim() !== "" ? search.q : undefined;
    return {
      ...(meal !== undefined && meal !== "all" ? { meal } : {}),
      ...(q !== undefined ? { q } : {}),
    };
  },
  component: RecipesPage,
});

function RecipesPage() {
  const { meal, q } = recipesRoute.useSearch();
  const navigate = recipesRoute.useNavigate();
  return (
    <RecipesScreen
      meal={meal ?? "all"}
      query={q ?? ""}
      onChange={(next) =>
        void navigate({
          replace: true,
          search: {
            ...(next.meal !== "all" ? { meal: next.meal } : {}),
            ...(next.query !== "" ? { q: next.query } : {}),
          },
        })
      }
    />
  );
}
