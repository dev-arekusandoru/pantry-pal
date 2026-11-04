import { createRootRoute, createRoute, Link, Outlet } from "@tanstack/react-router";
import { EmptyState, ErrorState, buttonClass } from "../ui";
import { ConnectionBanner } from "./ConnectionBanner";
import { Shell } from "./Shell";
import type { TabId } from "./tabs";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Which nav tab (and color) this route belongs to. */
    tab?: TabId;
    /** Hide the bottom nav below 768px (the left rail stays on wide screens). */
    hideNavOnMobile?: boolean;
  }
}

/**
 * Route tree skeleton. Screens create their own route in `screens/<name>/route.tsx`
 * with `getParentRoute: () => shellRoute` (tabbed pages) or `() => rootRoute`
 * (full-screen pages such as cook mode); `app/router.tsx` assembles them.
 */
export const rootRoute = createRootRoute({
  component: () => (
    <>
      <ConnectionBanner />
      <Outlet />
    </>
  ),
  notFoundComponent: () => (
    <EmptyState
      emoji="1FAD9"
      title="Nothing here"
      action={
        <Link to="/" className={buttonClass({ variant: "primary" })}>
          Back to the week
        </Link>
      }
    >
      That page does not exist.
    </EmptyState>
  ),
  errorComponent: ({ error, reset }) => <ErrorState error={error} onRetry={reset} />,
});

/** Layout route: nav bar / rail + tinted content area. */
export const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: Shell,
});
