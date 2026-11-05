import { VisuallyHidden } from "radix-ui";
import { useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, Icon, IconButton, PageHeader, Skeleton, toast } from "@/ui";
import { useHousehold, weekStartsOnOf } from "@/screens/settings/queries";
import { DayCard } from "./DayCard";
import { addDays, localToday, monthDay, selectedWeekStart, weekRange, weekStartFor } from "./dates";
import { PrepNudge } from "./PrepNudge";
import { usePlan, usePrepTasks, useRecipeIndex, useStartEmptyWeek } from "./queries";
import { SwapSheet, type SwapTarget } from "./SwapSheet";
import { TonightCard } from "./TonightCard";
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
}

export function WeekScreen({ week, onSelectWeek }: WeekScreenProps) {
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
  const startWeek = useStartEmptyWeek();
  const [target, setTarget] = useState<SwapTarget | null>(null);
  // A swap target belongs to one plan's slots; drop it when the visible week changes.
  useEffect(() => setTarget(null), [selectedWeek]);

  const browseWeek = (days: number) => {
    const next = addDays(selectedWeek, days);
    onSelectWeek(next === currentWeek ? null : next);
  };

  const title = isCurrentWeek ? "This week" : `Week of ${monthDay(selectedWeek)}`;
  const rangeLabel = weekRange(selectedWeek);
  const navRow = (
    <span className={styles.weekNav}>
      <IconButton
        className={styles.weekNavBtn}
        variant="plain"
        label="Previous week"
        icon={<Icon name="back" />}
        onClick={() => browseWeek(-7)}
      />
      <span className={styles.weekRange}>{rangeLabel}</span>
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
    </span>
  );

  const header = <PageHeader className={styles.weekHead} title={title} sub={navRow} />;

  if (plan.isPending) {
    return (
      <>
        {header}
        {/* The live region sits outside the busy skeletons: AT defers changes inside a busy subtree. */}
        <VisuallyHidden.Root role="status">Loading the week&hellip;</VisuallyHidden.Root>
        <div className={styles.loading} aria-busy="true">
          <Skeleton height={260} radius={34} />
          <Skeleton height={150} radius={28} />
          <Skeleton height={150} radius={28} />
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

  if (plan.data === null) {
    // Other weeks: a future week offers planning (coming soon), a past week just states the gap.
    if (!isCurrentWeek) {
      return (
        <>
          {header}
          {selectedWeek > currentWeek ? (
            <EmptyState
              emoji="1F5D3"
              title="Nothing planned for this week yet"
              action={
                <Button
                  variant="primary"
                  icon={<Icon name="plus" />}
                  onClick={() => toast.show({ message: "Coming soon — weekly planning is on the way" })}
                >
                  Plan this week
                </Button>
              }
            >
              Plan it here when weekly planning arrives, or ask your AI assistant to plan these days over MCP.
            </EmptyState>
          ) : (
            <EmptyState emoji="1F4ED" title="Nothing was planned that week" />
          )}
        </>
      );
    }
    return (
      <>
        {header}
        <EmptyState
          emoji="1F5D3"
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
          Ask your AI assistant to plan the week (it connects to PantryPal over MCP), or start an empty week and fill in
          each meal yourself.
        </EmptyState>
      </>
    );
  }

  const planView = plan.data;
  return (
    <>
      {header}
      {isCurrentWeek && (
        <TonightCard plan={planView} today={today} recipes={recipes.data} onSwap={setTarget} />
      )}
      {isCurrentWeek && prep.data && <PrepNudge tasks={prep.data} today={today} />}
      <ul className={styles.days}>
        {planView.days.map((day) => (
          <DayCard key={day.date} day={day} plan={planView} today={today} recipes={recipes.data} onSwap={setTarget} />
        ))}
      </ul>
      <SwapSheet target={target} plan={planView} onClose={() => setTarget(null)} />
    </>
  );
}
