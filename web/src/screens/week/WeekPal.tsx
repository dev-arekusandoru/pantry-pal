import type { CSSProperties } from "react";
import { Icon, Pal, cx } from "@/ui";
import { weekdayName } from "./dates";
import { palSays, weekStamps, type StampState } from "./stamps";
import type { PlanView } from "./model";
import styles from "./Week.module.css";

const STATE_LABEL: Record<StampState, string> = {
  cooked: "cooked",
  today: "tonight",
  missed: "not cooked",
  ahead: "coming up",
  free: "nothing planned",
};

/** Pal and the week's stamp card: one stamp per dinner cooked. */
export function WeekPal({ plan, today }: { plan: PlanView; today: string }) {
  const stamps = weekStamps(plan, today);
  const { mood, line } = palSays(plan, today, stamps);
  return (
    <section className={styles.pal} data-ui="pal" aria-label="Pal and this week's stamps">
      <Pal mood={mood} size={84} className={styles.palArt} />
      <div className={styles.palBody}>
        <p className={styles.palLine}>{line}</p>
        <ol className={styles.stamps}>
          {stamps.map((s, i) => (
            <li
              key={s.date}
              className={cx(styles.stamp, styles[s.state])}
              style={{ "--i": i } as CSSProperties}
              aria-label={`${weekdayName(s.date, "long")}: ${STATE_LABEL[s.state]}`}
            >
              <span className={styles.stampMark} aria-hidden="true">
                {s.state === "cooked" && <Icon name="check" size={20} />}
              </span>
              <span className={styles.stampDay} aria-hidden="true">
                {weekdayName(s.date, "short").slice(0, 1)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
