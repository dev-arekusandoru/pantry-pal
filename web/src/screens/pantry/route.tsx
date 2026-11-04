import { createRoute } from "@tanstack/react-router";
import { shellRoute } from "@/app/routes";
import { PantryScreen } from "./PantryScreen";

export const pantryRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/pantry",
  staticData: { tab: "pantry" },
  component: PantryScreen,
});
