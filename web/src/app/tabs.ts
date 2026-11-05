import type { EmojiCode, IconName } from "../ui";

export type TabId = "week" | "shop" | "pantry" | "recipes" | "settings";

export interface TabDef {
  id: TabId;
  label: string;
  to: "/" | "/shop" | "/pantry" | "/recipes" | "/settings";
  icon: IconName;
  /** OpenMoji sticker shown in the page header corner. */
  sticker: EmojiCode;
}

export const TABS: readonly TabDef[] = [
  { id: "week", label: "Week", to: "/", icon: "week", sticker: "1F373" },
  { id: "shop", label: "Shop", to: "/shop", icon: "shop", sticker: "1F9FA" },
  { id: "pantry", label: "Pantry", to: "/pantry", icon: "pantry", sticker: "1FAD9" },
  { id: "recipes", label: "Recipes", to: "/recipes", icon: "recipes", sticker: "1F4D6" },
  { id: "settings", label: "Settings", to: "/settings", icon: "settings", sticker: "2699" },
];
