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

/** Cook mode lives at `/recipes/$slug/cook` (see `screens/cook/route.tsx`). */
const COOK_PATHNAME = /^\/recipes\/[^/]+\/cook$/;

interface LocationChange {
  fromLocation?: { pathname: string } | undefined;
}

export function createAppRouter(options?: { history?: Parameters<typeof createRouter>[0]["history"] }) {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    // Short crossfade between routes via the View Transitions API. A no-op where
    // `document.startViewTransition` is missing (older browsers, jsdom).
    // Cook mode is entered as a step forward and left as a step back: the
    // `from-cook` type flips the enter animation in base.css. Browsers without
    // typed view transitions just get the default (forward) treatment.
    defaultViewTransition: {
      types: ({ fromLocation }: LocationChange) => {
        // The first load is not a navigation: fading the app in from a blank page
        // would only delay the content the user is waiting for.
        if (fromLocation === undefined) return false;
        return COOK_PATHNAME.test(fromLocation.pathname) ? ["from-cook"] : [];
      },
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
