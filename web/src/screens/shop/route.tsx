import { createRoute } from "@tanstack/react-router";
import { shellRoute } from "@/app/routes";
import { ShopScreen } from "./ShopScreen";

export const shopRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/shop",
  staticData: { tab: "shop" },
  /** `?list=` names the list being shopped; it survives reloads. */
  validateSearch: (search: Record<string, unknown>): { list?: string } =>
    typeof search.list === "string" && search.list !== "" ? { list: search.list } : {},
  component: ShopPage,
});

function ShopPage() {
  const { list } = shopRoute.useSearch();
  const navigate = shopRoute.useNavigate();
  // Same page, new search: keep the scroll position and skip the page crossfade.
  return (
    <ShopScreen
      listId={list}
      onSelectList={(id) => void navigate({ search: id === undefined ? {} : { list: id }, replace: true, resetScroll: false, viewTransition: false })}
    />
  );
}
