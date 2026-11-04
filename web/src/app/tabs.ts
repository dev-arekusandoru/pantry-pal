import type { IconName } from "../ui";

export type TabId = "week" | "shop" | "pantry" | "recipes" | "settings";

export interface TabDef {
  id: TabId;
  label: string;
  to: "/" | "/shop" | "/pantry" | "/recipes" | "/settings";
  icon: IconName;
}

export const TABS: readonly TabDef[] = [
  { id: "week", label: "Week", to: "/", icon: "week" },
  { id: "shop", label: "Shop", to: "/shop", icon: "shop" },
  { id: "pantry", label: "Pantry", to: "/pantry", icon: "pantry" },
  { id: "recipes", label: "Recipes", to: "/recipes", icon: "recipes" },
  { id: "settings", label: "Settings", to: "/settings", icon: "settings" },
];
