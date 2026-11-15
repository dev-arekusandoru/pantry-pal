import { useRef, useState } from "react";
import type { RecipeSummary } from "../../model";
import type { Draft, PlannerProps } from "../draft";
import { DayBody } from "./shared/Meals";
import styles from "./shared/mobile.module.css";
import { DayStrip, markWeekSwiped } from "./Strip";

export interface MobilePlannerProps extends Pick<PlannerProps, "onWeek" | "arrival"> {
  draft: Draft;
  setDraft: (fn: (d: Draft) => Draft) => void;
  recipes: Map<string, RecipeSummary> | undefined;
  today: string;
}

/** One day at a time: the 7-chip strip picks the day (swipe it to change week); the day itself sits on a paper card (swipe it to change day). */
export function DayPlanner({ draft, setDraft, recipes, today, onWeek, arrival }: MobilePlannerProps) {
  const [date, setDate] = useState(
    () => (arrival && draft.days[arrival.day]) || (draft.days.includes(today) ? today : (draft.days[0] ?? draft.weekStart)),
  );
  const index = draft.days.indexOf(date);
  const swipe = useRef<{ x: number; week: boolean } | null>(null);

  const go = (step: number) => {
    const next = draft.days[index + step];
    if (next) setDate(next);
  };
  const week = (step: -1 | 1, keyboard = false) => {
    if (!onWeek) return;
    markWeekSwiped();
    onWeek(step, index, keyboard);
  };

  return (
    <div
      className={styles.dayView}
      data-slide={arrival?.dir}
      onTouchStart={(e) => {
        const x = e.touches[0]?.clientX;
        const target = e.target as Element;
        // Horizontally scrolling regions (the cook row) keep their own gestures.
        swipe.current = x === undefined || target.closest("[data-no-swipe]") ? null : { x, week: Boolean(target.closest("[data-week-swipe]")) };
      }}
      onTouchEnd={(e) => {
        const s = swipe.current;
        swipe.current = null;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - (s?.x ?? 0);
        if (!s || Math.abs(dx) <= 48) return;
        if (s.week) week(dx < 0 ? 1 : -1);
        else go(dx < 0 ? 1 : -1);
      }}
    >
      <DayStrip days={draft.days} date={date} today={today} draft={draft} onSelect={setDate} onWeek={onWeek ? (step) => week(step, true) : undefined} refocus={arrival?.keyboard} />

      <div className={styles.dayCard}>
        <DayBody draft={draft} setDraft={setDraft} recipes={recipes} date={date} />
      </div>
    </div>
  );
}
