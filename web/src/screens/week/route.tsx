import { createRoute } from "@tanstack/react-router";
import { shellRoute } from "@/app/routes";
import { parseWeekParam } from "./dates";
import { WeekScreen } from "./WeekScreen";

export const weekRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  staticData: { tab: "week" },
  /** `?week=YYYY-MM-DD` deep-links a browsed week; invalid values drop to the current week. */
  validateSearch: (search: Record<string, unknown>): { week?: string } => {
    const week = parseWeekParam(search.week);
    return week ? { week } : {};
  },
  component: WeekPage,
});

function WeekPage() {
  const { week } = weekRoute.useSearch();
  const navigate = weekRoute.useNavigate();
  return (
    <WeekScreen
      week={week}
      onSelectWeek={(weekStart) =>
        // Same page, new search: keep the scroll position and skip the page crossfade.
        void navigate({ search: weekStart === null ? {} : { week: weekStart }, resetScroll: false, viewTransition: false })
      }
    />
  );
}
