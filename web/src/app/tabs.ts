import type { EmojiCode, IconName } from "../ui";

export type TabId = "week" | "shop" | "pantry" | "recipes" | "settings";

export interface TabDef {
  id: TabId;
  label: string;
  to: "/" | "/shop" | "/pantry" | "/recipes" | "/settings";
  icon: IconName;
  /** Food-icon sticker shown in the page header corner. */
  sticker: EmojiCode;
}

export const TABS: readonly TabDef[] = [
  { id: "week", label: "Week", to: "/", icon: "week", sticker: "fried-egg" },
  { id: "shop", label: "Shop", to: "/shop", icon: "shop", sticker: "bell-peppers" },
  { id: "pantry", label: "Pantry", to: "/pantry", icon: "pantry", sticker: "relish" },
  { id: "recipes", label: "Recipes", to: "/recipes", icon: "recipes", sticker: "roast-chicken" },
  { id: "settings", label: "Settings", to: "/settings", icon: "settings", sticker: "salt" },
];
