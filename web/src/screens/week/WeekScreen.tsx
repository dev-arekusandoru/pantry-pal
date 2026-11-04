import { useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, Icon, PageHeader, Skeleton } from "@/ui";
import { DayCard } from "./DayCard";
import { localToday, weekRange } from "./dates";
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

export function WeekScreen() {
  const today = useToday();
  const plan = usePlan();
  const recipes = useRecipeIndex();
  const prep = usePrepTasks(today);
  const startWeek = useStartEmptyWeek();
  const [target, setTarget] = useState<SwapTarget | null>(null);

  if (plan.isPending) {
    return (
      <>
        <PageHeader title="This week" />
        <div className={styles.loading} aria-busy="true" aria-label="Loading the week">
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
        <PageHeader title="This week" />
        <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />
      </>
    );
  }

  if (plan.data === null) {
    return (
      <>
        <PageHeader title="This week" sub="No plan yet" />
        <EmptyState
          emoji="🗓️"
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

  const week = plan.data;
  return (
    <>
      <PageHeader title="This week" sub={weekRange(week.weekStart)} />
      <TonightCard plan={week} today={today} recipes={recipes.data} onSwap={setTarget} />
      {prep.data && <PrepNudge tasks={prep.data} today={today} />}
      <ul className={styles.days}>
        {week.days.map((day) => (
          <DayCard key={day.date} day={day} plan={week} today={today} recipes={recipes.data} onSwap={setTarget} />
        ))}
      </ul>
      <SwapSheet target={target} plan={week} onClose={() => setTarget(null)} />
    </>
  );
}
