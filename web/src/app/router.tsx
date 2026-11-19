import { createRouter } from "@tanstack/react-router";
import { cookRoute } from "@/screens/cook/route";
import { dexRoute } from "@/screens/dex/route";
import { ingredientRoute, ingredientsRoute, reviewRedirectRoute } from "@/screens/ingredients/route";
import { pantryRoute } from "@/screens/pantry/route";
import { editRecipeRoute, newRecipeRoute } from "@/screens/recipe-edit/route";
import { recipeRoute } from "@/screens/recipe/route";
import { recipesRoute } from "@/screens/recipes/route";
import { settingsRoute } from "@/screens/settings/route";
import { shopRoute } from "@/screens/shop/route";
import { weekRoute } from "@/screens/week/route";
import { rootRoute, shellRoute } from "./routes";

/**
 * Route tree. To add a screen: create `screens/<name>/route.tsx` and list it here.
 * Tabbed screens hang off `shellRoute`, full-screen ones off `rootRoute`.
 */
const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([weekRoute, shopRoute, pantryRoute, recipesRoute, dexRoute, ingredientsRoute, ingredientRoute, reviewRedirectRoute, recipeRoute, newRecipeRoute, editRecipeRoute, settingsRoute]),
  cookRoute,
]);

export function createAppRouter(options?: { history?: Parameters<typeof createRouter>[0]["history"] }) {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    // Short crossfade between routes via the View Transitions API. A no-op where
    // `document.startViewTransition` is missing (older browsers, jsdom).
    // The first load is not a navigation: fading the app in from a blank page
    // would only delay the content the user is waiting for.
    defaultViewTransition: {
      types: ({ fromLocation }: { fromLocation?: unknown }) => (fromLocation === undefined ? false : []),
    },
    ...options,
  });
}

export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
