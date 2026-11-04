import { createRoute } from "@tanstack/react-router";
import { shellRoute } from "@/app/routes";
import { STATUS_VIEWS, type StatusView } from "./filter";
import { RecipesScreen } from "./RecipesScreen";
import { MEAL_FILTERS, type MealFilter } from "./queries";

export interface RecipesSearch {
  view?: Exclude<StatusView, "box">;
  meal?: Exclude<MealFilter, "all">;
  q?: string;
}

export const recipesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/recipes",
  staticData: { tab: "recipes" },
  // Filters live in the URL so Back from a recipe returns to the same list.
  validateSearch: (search: Record<string, unknown>): RecipesSearch => {
    const view = STATUS_VIEWS.find((v) => v !== "box" && v === search.view);
    const meal = MEAL_FILTERS.find((m) => m !== "all" && m === search.meal);
    const q = typeof search.q === "string" && search.q.trim() !== "" ? search.q : undefined;
    return {
      ...(view !== undefined && view !== "box" ? { view } : {}),
      ...(meal !== undefined && meal !== "all" ? { meal } : {}),
      ...(q !== undefined ? { q } : {}),
    };
  },
  component: RecipesPage,
});

function RecipesPage() {
  const { view, meal, q } = recipesRoute.useSearch();
  const navigate = recipesRoute.useNavigate();
  return (
    <RecipesScreen
      view={view ?? "box"}
      meal={meal ?? "all"}
      query={q ?? ""}
      onChange={(next) =>
        void navigate({
          replace: true,
          search: {
            ...(next.view !== "box" ? { view: next.view } : {}),
            ...(next.meal !== "all" ? { meal: next.meal } : {}),
            ...(next.query !== "" ? { q: next.query } : {}),
          },
        })
      }
    />
  );
}
