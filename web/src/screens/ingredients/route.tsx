import { createRoute, redirect } from "@tanstack/react-router";
import { shellRoute } from "@/app/routes";
import { IngredientScreen } from "./IngredientScreen";
import { IngredientsScreen } from "./IngredientsScreen";
import { parseFilter, type LibraryFilter } from "./library";

export interface IngredientsSearch {
  filter?: Exclude<LibraryFilter, "all">;
}

export const ingredientsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/ingredients",
  staticData: { tab: "pantry" },
  // The chip lives in the URL so a link can open "Needs attention" and Back returns to it.
  validateSearch: (search: Record<string, unknown>): IngredientsSearch => {
    const filter = parseFilter(search.filter);
    return filter === "all" ? {} : { filter };
  },
  component: IngredientsPage,
});

function IngredientsPage() {
  const { filter } = ingredientsRoute.useSearch();
  const navigate = ingredientsRoute.useNavigate();
  return (
    <IngredientsScreen
      filter={filter ?? "all"}
      // Same page, new search: keep the scroll position and skip the page crossfade.
      onFilter={(next) =>
        void navigate({
          search: next === "all" ? {} : { filter: next },
          replace: true,
          resetScroll: false,
          viewTransition: false,
        })
      }
    />
  );
}

export const ingredientRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/ingredients/$id",
  staticData: { tab: "pantry" },
  component: IngredientPage,
});

function IngredientPage() {
  const { id } = ingredientRoute.useParams();
  return <IngredientScreen key={id} id={id} />;
}

/** The old review screen is the "Needs attention" chip of the library. */
export const reviewRedirectRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/ingredients/review",
  beforeLoad: () => {
    throw redirect({ to: "/ingredients", search: { filter: "attention" }, replace: true });
  },
});
