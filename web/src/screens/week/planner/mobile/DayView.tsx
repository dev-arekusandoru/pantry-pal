import { useRef, useState } from "react";
import { Icon, IconButton } from "@/ui";
import { monthDay, weekdayName } from "../../dates";
import type { RecipeSummary } from "../../model";
import type { Draft } from "../draft";
import styles from "./shared/mobile.module.css";
import { DayBody } from "./shared/Meals";

export interface MobilePlannerProps {
  draft: Draft;
  setDraft: (fn: (d: Draft) => Draft) => void;
  recipes: Map<string, RecipeSummary> | undefined;
  today: string;
}

/** One day at a time: 7-dot strip, prev/next, swipe; the day itself sits on a paper card. */
export function DayPlanner({ draft, setDraft, recipes, today }: MobilePlannerProps) {
  const [date, setDate] = useState(() => (draft.days.includes(today) ? today : (draft.days[0] ?? draft.weekStart)));
  const index = draft.days.indexOf(date);
  const swipeFrom = useRef<number | null>(null);

  const go = (step: number) => {
    const next = draft.days[index + step];
    if (next) setDate(next);
  };

  return (
    <div
      className={styles.dayView}
      onTouchStart={(e) => {
        swipeFrom.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const from = swipeFrom.current;
        swipeFrom.current = null;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - (from ?? 0);
        if (from !== null && Math.abs(dx) > 48) go(dx < 0 ? 1 : -1);
      }}
    >
      <nav className={styles.dayStrip} aria-label="Choose a day">
        {draft.days.map((d) => {
          const planned =
            draft.batches.reduce((n, b) => n + b.eats.filter((e) => e.date === d).length, 0) +
            draft.notes.filter((n) => n.date === d).length;
          return (
            <button
              key={d}
              type="button"
              className={styles.stripBtn}
              aria-pressed={d === date}
              aria-label={`${weekdayName(d)} ${monthDay(d)}, ${planned === 0 ? "nothing planned" : `${planned} planned`}`}
              onClick={() => setDate(d)}
            >
              <span className={styles.stripDot} data-filled={planned > 0 ? "" : undefined}>
                {planned > 0 ? planned : ""}
              </span>
              <span className={styles.stripName} aria-hidden="true">
                {weekdayName(d, "short")}
              </span>
            </button>
          );
        })}
      </nav>

      <div className={styles.dayNav}>
        <IconButton label="Previous day" variant="plain" icon={<Icon name="back" />} disabled={index <= 0} onClick={() => go(-1)} />
        <h2 className={styles.dayTitle}>
          {weekdayName(date)} <span>{monthDay(date)}</span>
          {date === today && <span className={styles.todayFlag}>Today</span>}
        </h2>
        <IconButton
          label="Next day"
          variant="plain"
          icon={<Icon name="back" style={{ transform: "scaleX(-1)" }} />}
          disabled={index >= draft.days.length - 1}
          onClick={() => go(1)}
        />
      </div>

      <div className={styles.dayCard}>
        <DayBody draft={draft} setDraft={setDraft} recipes={recipes} date={date} />
      </div>
    </div>
  );
}
