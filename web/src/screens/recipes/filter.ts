import type { components } from "@/api";

export type RecipeStatus = components["schemas"]["RecipeStatus"];

/** The two lists the recipe box can show. */
export const STATUS_VIEWS = ["box", "never"] as const;
export type StatusView = (typeof STATUS_VIEWS)[number];

/** Default view: favorites and things still to try. */
const IN_BOX: Record<RecipeStatus, boolean> = {
  want_to_try: true,
  rotation: true,
  never: false,
  archived: false,
};

/** Archived recipes are hidden from every view; `never` only shows in its own list. */
export function isInStatusView(status: RecipeStatus, view: StatusView): boolean {
  return view === "never" ? status === "never" : IN_BOX[status];
}

export function filterByStatusView<T extends { status: RecipeStatus }>(
  items: readonly T[],
  view: StatusView,
): T[] {
  return items.filter((item) => isInStatusView(item.status, view));
}

/** New recipes carry a small tag so they are distinguishable inside the default list. */
export function isNewToTry(status: RecipeStatus): boolean {
  return status === "want_to_try";
}
