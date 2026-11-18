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

const STORAGE_KEY = "pantry-pal:shop-list";

function ShopPage() {
  const { list } = shopRoute.useSearch();
  const navigate = shopRoute.useNavigate();
  // The URL wins; otherwise the list last picked this session, so leaving the tab and returning keeps it.
  const listId = list ?? sessionStorage.getItem(STORAGE_KEY) ?? undefined;
  // Same page, new search: keep the scroll position and skip the page crossfade.
  return (
    <ShopScreen
      listId={listId}
      onSelectList={(id) => {
        if (id === undefined) sessionStorage.removeItem(STORAGE_KEY);
        else sessionStorage.setItem(STORAGE_KEY, id);
        void navigate({ search: id === undefined ? {} : { list: id }, replace: true, resetScroll: false, viewTransition: false });
      }}
    />
  );
}
