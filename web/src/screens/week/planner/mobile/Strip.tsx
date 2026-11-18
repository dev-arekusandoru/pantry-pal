import { VisuallyHidden } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { monthDay, weekdayName } from "../../dates";
import { CORE_MEALS } from "../../model";
import type { Draft } from "../draft";
import styles from "./shared/mobile.module.css";

const HINT_KEY = "pantrypal.weekSwipeHint";

/** The first week change retires the "Swipe the days" caption for good. */
export function markWeekSwiped() {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    // Storage blocked: the caption just shows again next time.
  }
}

function hintPending(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === null;
  } catch {
    return false;
  }
}

interface DayStripProps {
  days: readonly string[];
  date: string;
  today: string;
  draft: Draft;
  onSelect: (date: string) => void;
  /** Previous (-1) or next (1) week; absent = the strip does not change weeks. */
  onWeek?: (step: -1 | 1) => void;
  /** Mounted by a week change: keep keyboard focus on the selected day (the control that was used is gone). */
  refocus?: boolean;
}

/**
 * The day navigator: one tab per day, the only control that changes the day. Arrow keys move, one tab stop.
 * Swiping it changes week; keyboard and screen-reader users get Alt+arrows, PageUp/PageDown and two hidden buttons.
 */
export function DayStrip({ days, date, today, draft, onSelect, onWeek, refocus }: DayStripProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [hint] = useState(() => onWeek !== undefined && hintPending());
  useEffect(() => {
    if (refocus) refs.current.get(date)?.focus({ preventScroll: true });
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (index: number) => {
    const next = days[Math.max(0, Math.min(days.length - 1, index))];
    if (!next) return;
    onSelect(next);
    refs.current.get(next)?.focus();
  };

  return (
    <>
    <nav
      className={styles.strip}
      aria-label="Choose a day"
      data-week-swipe={onWeek ? "" : undefined}
      onKeyDown={(e) => {
        const i = days.indexOf(date);
        if (onWeek && (e.key === "PageUp" || e.key === "PageDown" || (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")))) {
          onWeek(e.key === "PageUp" || e.key === "ArrowLeft" ? -1 : 1);
        } else if (e.key === "ArrowRight") pick(i + 1);
        else if (e.key === "ArrowLeft") pick(i - 1);
        else if (e.key === "Home") pick(0);
        else if (e.key === "End") pick(days.length - 1);
        else return;
        e.preventDefault();
      }}
    >
      {days.map((d) => {
        const eats = draft.batches.flatMap((b) => b.eats.filter((e) => e.date === d));
        const notes = draft.notes.filter((n) => n.date === d);
        const count = eats.length + notes.length;
        const planned = new Set([...eats.map((e) => e.mealType), ...notes.map((n) => n.mealType)]);
        const isToday = d === today;
        return (
          <button
            key={d}
            type="button"
            ref={(el) => {
              if (el) refs.current.set(d, el);
              else refs.current.delete(d);
            }}
            className={styles.stripTab}
            aria-pressed={d === date}
            aria-label={`${weekdayName(d)} ${monthDay(d)}, ${isToday ? "today, " : ""}${
              count === 0 ? "nothing planned" : `${count} ${count === 1 ? "dish" : "dishes"} planned`
            }`}
            tabIndex={d === date ? 0 : -1}
            data-today={isToday ? "" : undefined}
            onClick={() => onSelect(d)}
          >
            <span className={styles.stripFace} aria-hidden="true">
              <span className={styles.stripDay}>{weekdayName(d, "short").slice(0, 2)}</span>
              <span className={styles.stripNum}>{Number(d.slice(8))}</span>
            </span>
            <span className={styles.stripDots} aria-hidden="true">
              {CORE_MEALS.map((m) => (
                <span key={m} className={styles.stripMealDot} data-filled={planned.has(m) ? "" : undefined} />
              ))}
            </span>
          </button>
        );
      })}
      {onWeek && (
        <>
          <span className={styles.stripChevron} data-side="start" aria-hidden="true">
            ‹
          </span>
          <span className={styles.stripChevron} data-side="end" aria-hidden="true">
            ›
          </span>
        </>
      )}
    </nav>
    {hint && (
      <p className={styles.stripHint} aria-hidden="true">
        Swipe the days to change week
      </p>
    )}
    {onWeek && (
      <>
        <VisuallyHidden.Root asChild>
          <button type="button" onClick={() => onWeek(-1)}>
            Previous week
          </button>
        </VisuallyHidden.Root>
        <VisuallyHidden.Root asChild>
          <button type="button" onClick={() => onWeek(1)}>
            Next week
          </button>
        </VisuallyHidden.Root>
      </>
    )}
    </>
  );
}
