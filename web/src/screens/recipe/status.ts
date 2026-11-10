import type { components } from "@/api";

export type RecipeStatus = components["schemas"]["RecipeStatus"];

/** Statuses the household can pick by hand; `archived` has no UI. */
export type EditableStatus = Exclude<RecipeStatus, "archived">;

/** Toast text after a status change, e.g. `Moved Stew to never`. */
export const STATUS_PHRASES: Record<RecipeStatus, string> = {
  want_to_try: "want to try",
  rotation: "the rotation",
  never: "never",
  archived: "the archive",
};
