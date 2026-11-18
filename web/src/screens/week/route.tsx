import { createRoute } from "@tanstack/react-router";
import { shellRoute } from "@/app/routes";
import { parseWeekParam } from "./dates";
import { WeekScreen } from "./WeekScreen";

export const weekRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  staticData: { tab: "week" },
  /**
   * `?week=YYYY-MM-DD` deep-links a browsed week; invalid values drop to the current week. `?plan=1` opens Plan mode.
   */
  validateSearch: (search: Record<string, unknown>): { week?: string; plan?: boolean } => {
    const week = parseWeekParam(search.week);
    const plan = Boolean(search.plan);
    return { ...(week ? { week } : {}), ...(plan ? { plan } : {}) };
  },
  component: WeekPage,
});

const STORAGE_KEY = "pantry-pal:week";

function WeekPage() {
  const { week: urlWeek, plan } = weekRoute.useSearch();
  const navigate = weekRoute.useNavigate();
  // The URL wins; otherwise the week last browsed this session, so leaving the tab and returning keeps it.
  const week = urlWeek ?? parseWeekParam(sessionStorage.getItem(STORAGE_KEY)) ?? undefined;
  return (
    <WeekScreen
      week={week}
      onSelectWeek={(weekStart) => {
        if (weekStart === null) sessionStorage.removeItem(STORAGE_KEY);
        else sessionStorage.setItem(STORAGE_KEY, weekStart);
        // Same page, new search: keep the scroll position and skip the page crossfade.
        void navigate({
          search: {
            ...(weekStart === null ? {} : { week: weekStart }),
            ...(plan ? { plan: true } : {}),
          },
          resetScroll: false,
          viewTransition: false,
        });
      }}
      planning={plan === true}
      onPlanning={(on) =>
        void navigate({ search: (prev) => ({ ...prev, plan: on || undefined }), replace: true, resetScroll: false, viewTransition: false })
      }
    />
  );
}
