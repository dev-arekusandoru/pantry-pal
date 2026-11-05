import { createRoute } from "@tanstack/react-router";
import { shellRoute } from "@/app/routes";
import { validateCookSearch } from "./lib";
import { RecipeScreen } from "./RecipeScreen";

export const recipeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/recipes/$slug",
  // Part of the Recipes tab; on phones the recipe covers the nav bar.
  staticData: { tab: "recipes", hideNavOnMobile: true },
  validateSearch: validateCookSearch,
  component: RecipePage,
});

function RecipePage() {
  const { slug } = recipeRoute.useParams();
  const { cookEvent, servings } = recipeRoute.useSearch();
  return (
    <RecipeScreen
      key={slug}
      slug={slug}
      {...(cookEvent !== undefined ? { cookEvent } : {})}
      {...(servings !== undefined ? { servings } : {})}
    />
  );
}
