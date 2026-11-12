import { Button, Icon, cx } from "@/ui";
import { formatClock, formatDuration } from "../recipe/duration";
import type { StepTimer as Timer } from "./timers";
import styles from "./CookScreen.module.css";

/** The shared per-step timer state the cook screen and its crew panels both drive. */
export interface StepTimers {
  timers: Record<number, Timer>;
  remaining: (step: number) => number;
  start: (step: number, seconds: number) => void;
  cancel: (step: number) => void;
}

/**
 * One step's timer button / running clock, kept out of the step's live region.
 * The timer is keyed by recipe step, so solo and crew views share it.
 */
export function StepTimerRow({
  index,
  seconds,
  timers,
  leaving,
}: {
  /** Recipe step index the timer belongs to. */
  index: number;
  seconds: number;
  timers: StepTimers;
  /** The step is fading out, so its controls must not take focus. */
  leaving?: boolean;
}) {
  const timer = timers.timers[index];
  const left = formatClock(timers.remaining(index));

  return (
    <div className={styles.timerRow} aria-live="off">
      {timer === undefined || timer.finished ? (
        <button
          type="button"
          className={styles.timer}
          tabIndex={leaving ? -1 : undefined}
          onClick={() => timers.start(index, seconds)}
        >
          <Icon name={timer?.finished ? "refresh" : "timer"} />
          {timer?.finished ? `Done. Restart ${formatDuration(seconds)}` : `Start ${formatDuration(seconds)} timer`}
        </button>
      ) : (
        <>
          <span className={cx(styles.timer, styles.running)} role="timer" aria-label={`Time left ${left}`}>
            <Icon name="timer" />
            {left}
          </span>
          <Button
            variant="ghost"
            className={styles.cancel}
            tabIndex={leaving ? -1 : undefined}
            onClick={() => timers.cancel(index)}
          >
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}
