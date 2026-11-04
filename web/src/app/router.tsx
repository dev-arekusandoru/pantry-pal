import { createRouter } from "@tanstack/react-router";
import { cookRoute } from "@/screens/cook/route";
import { pantryRoute } from "@/screens/pantry/route";
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
  shellRoute.addChildren([weekRoute, shopRoute, pantryRoute, recipesRoute, recipeRoute, settingsRoute]),
  cookRoute,
]);

export function createAppRouter(options?: { history?: Parameters<typeof createRouter>[0]["history"] }) {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    ...options,
  });
}

export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
