import { createRoute } from "@tanstack/react-router";
import { shellRoute } from "@/app/routes";
import { WeekScreen } from "./WeekScreen";

export const weekRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  staticData: { tab: "week" },
  component: WeekScreen,
});
