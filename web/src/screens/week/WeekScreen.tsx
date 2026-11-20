import { VisuallyHidden } from "radix-ui";
import { useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, Icon, IconButton, PageHeader, Skeleton } from "@/ui";
import { useCookHistory } from "@/game/history";
import { useHousehold, weekStartsOnOf } from "@/screens/settings/queries";
import { addDays, localToday, monthDay, selectedWeekStart, weekRange, weekStartFor } from "./dates";
import { usePlan, usePrepTasks, useRecipeIndex, useStartEmptyWeek } from "./queries";
import { SwapSheet, type SwapTarget } from "./SwapSheet";
import { Planner } from "./planner/Planner";
import { emptyPlan } from "./planner/model";
import { WeekBody } from "./WeekBody";
import styles from "./Week.module.css";

/** The browser's local date, refreshed when the tab comes back (the page may stay open overnight). */
function useToday(): string {
  const [today, setToday] = useState(localToday);
  useEffect(() => {
    const refresh = () => setToday(localToday());
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return today;
}

export interface WeekScreenProps {
  /** The route's validated `?week=` param; undefined = current week. */
  week?: string;
  /** Show the week starting `weekStart`, or the current week when null. */
  onSelectWeek: (weekStart: string | null) => void;
  /** Plan mode (`?plan=1`): the draggable week planner instead of the read-only week. */
  planning?: boolean;
  onPlanning: (planning: boolean) => void;
}

export function WeekScreen({ week, onSelectWeek, planning = false, onPlanning }: WeekScreenProps) {
  const today = useToday();
  const household = useHousehold();
  // Plans are keyed by the household's first weekday; weekStartsOnOf returns
  // Monday when a stale API answers without settings (see settings/queries).
  const weekStartsOn = weekStartsOnOf(household.data);
  const currentWeek = weekStartFor(today, weekStartsOn);
  const selectedWeek = selectedWeekStart(week, today, weekStartsOn);
  const isCurrentWeek = selectedWeek === currentWeek;
  const plan = usePlan(selectedWeek);
  const recipes = useRecipeIndex();
  const prep = usePrepTasks(today);
  const cookHistory = useCookHistory();
  const startWeek = useStartEmptyWeek();
  const [target, setTarget] = useState<SwapTarget | null>(null);
  // Set by a week swipe in the phone planner: the weekday to keep and the slide direction.
  const [arrival, setArrival] = useState<{ day: number; dir: -1 | 1; keyboard: boolean }>();
  useEffect(() => {
    if (!planning) setArrival(undefined);
  }, [planning]);
  // A swap target belongs to one plan's slots; drop it when the visible week changes.
  useEffect(() => setTarget(null), [selectedWeek]);

  const browseWeek = (days: number) => {
    const next = addDays(selectedWeek, days);
    onSelectWeek(next === currentWeek ? null : next);
  };

  const title = isCurrentWeek ? "This week" : `Week of ${monthDay(selectedWeek)}`;
  const rangeLabel = weekRange(selectedWeek);
  const nav = (
    <nav className={styles.weekNav} aria-label="Week navigation">
      <IconButton
        className={styles.weekNavBtn}
        variant="plain"
        label="Previous week"
        icon={<Icon name="back" />}
        onClick={() => browseWeek(-7)}
      />
      <IconButton
        className={styles.weekNavBtn}
        variant="plain"
        label="Next week"
        icon={<Icon name="back" style={{ transform: "scaleX(-1)" }} />}
        onClick={() => browseWeek(7)}
      />
      {!isCurrentWeek && (
        <Button className={styles.weekJump} onClick={() => onSelectWeek(null)}>
          This week
        </Button>
      )}
      <Button className={styles.weekJump} onClick={() => onPlanning(!planning)} aria-pressed={planning}>
        {planning ? "Done planning" : "Plan"}
      </Button>
    </nav>
  );
  const header = (
    <PageHeader
      className={styles.weekHead}
      title={title}
      sub={rangeLabel}
      aside={nav}
    />
  );

  // A "no plan" answer kept from the previous week says nothing about this one; the planner must not mount an empty grid for it.
  if (plan.isPending || (planning && plan.isPlaceholderData && plan.data === null)) {
    return (
      <>
        {header}
        {/* The live region sits outside the busy skeletons: AT defers changes inside a busy subtree. */}
        <VisuallyHidden.Root role="status">Loading the week&hellip;</VisuallyHidden.Root>
        <div className={styles.loading} aria-busy="true">
          {/* Heights track the real cards (tonight, then a day each) so the swap to content barely moves. */}
          <Skeleton height={260} radius={34} />
          <Skeleton height={240} radius={28} />
          <Skeleton height={240} radius={28} />
        </div>
      </>
    );
  }

  if (plan.isError) {
    return (
      <>
        {header}
        <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />
      </>
    );
  }

  if (plan.data === null && !planning) {
    // Other weeks: offer to plan it (future) or state the gap (past); either way Plan mode is one tap away.
    if (!isCurrentWeek) {
      const planIt = (
        <Button variant="primary" icon={<Icon name="plus" />} onClick={() => onPlanning(true)}>
          Plan this week
        </Button>
      );
      return (
        <>
          {header}
          {selectedWeek > currentWeek ? (
            <EmptyState emoji="lettuce" title="Nothing planned for this week yet" action={planIt}>
              Or ask your AI assistant to plan these days over MCP.
            </EmptyState>
          ) : (
            <EmptyState emoji="empty-bowl" title="Nothing was planned that week" action={planIt}>
              Or ask your AI assistant to plan these days over MCP.
            </EmptyState>
          )}
        </>
      );
    }
    return (
      <>
        {header}
        <EmptyState
          emoji="lettuce"
          title="Nothing planned this week"
          action={
            <Button
              variant="primary"
              icon={<Icon name="plus" />}
              loading={startWeek.isPending}
              onClick={() => startWeek.mutate()}
            >
              Start an empty week
            </Button>
          }
        >
          Ask your AI assistant to plan the week (it connects to Rakumi over MCP), or start an empty week and fill in
          each meal yourself.
        </EmptyState>
      </>
    );
  }

  if (planning) {
    // A week without a plan edits an empty grid; the first save creates the plan.
    // While the next week loads, the previous planner stays up (keepPreviousData); its key swaps it out on arrival.
    const planView = plan.data ?? emptyPlan(selectedWeek);
    return (
      <Planner
        key={planView.weekStart}
        plan={planView}
        recipes={recipes.data}
        today={today}
        onWeek={(step, day, keyboard) => {
          setArrival({ day, dir: step, keyboard });
          browseWeek(step * 7);
        }}
        arrival={planView.weekStart === selectedWeek ? arrival : undefined}
        header={(narrow, status) =>
          narrow ? (
            <div className={styles.planTop}>
              <div className={styles.planTitleBox}>
                <h1 className={styles.planTitle}>{title}</h1>
                <p className={styles.planRange}>{rangeLabel}</p>
                <div className={styles.planStatus}>{status}</div>
              </div>
              <div className={styles.planSide}>
                <span className={styles.planSticker} aria-hidden="true" />
                <Button variant="primary" className={styles.planDone} onClick={() => onPlanning(false)}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            header
          )
        }
      />
    );
  }
  const planView = plan.data!;
  return (
    <>
      {header}
      <div className={styles.planBlock} data-updating={plan.isPlaceholderData || undefined} aria-busy={plan.isPlaceholderData || undefined}>
        <WeekBody
          plan={planView}
          today={today}
          now={new Date()}
          isCurrentWeek={isCurrentWeek}
          recipes={recipes.data}
          prep={prep.data}
          history={cookHistory.data}
          onSwap={setTarget}
        />
      </div>
      <SwapSheet target={target} plan={planView} onClose={() => setTarget(null)} />
    </>
  );
}
