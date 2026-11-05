import { useState } from "react";
import { Button, Icon, cx } from "@/ui";
import { pickNextPrep, prepDueLabel, type PrepTask } from "./model";
import { useCompletePrepTask } from "./queries";
import styles from "./Week.module.css";

interface PrepNudgeProps {
  tasks: readonly PrepTask[];
  today: string;
  /** True when this mounts after the week's first paint, so it should fade in. */
  fadeIn?: boolean;
}

/** The next prep task with a one-tap "Done". Renders nothing when there is none. */
export function PrepNudge({ tasks, today, fadeIn }: PrepNudgeProps) {
  const complete = useCompletePrepTask();
  // Frozen at mount: a nudge that is already there with the week's first paint is
  // captured by the route transition, so it must not start its own fade.
  const [animate] = useState(fadeIn === true);
  const picked = pickNextPrep(tasks, today);
  if (!picked) return null;
  const { next, rest } = picked;

  return (
    <section className={cx(styles.nudge, animate && styles.nudgeFade)} aria-label="Next prep task">
      <span className={styles.nudgeIcon} aria-hidden="true">
        <Icon name="timer" size="100%" />
      </span>
      <div className={styles.nudgeText}>
        <p className={styles.nudgeWhen}>
          {prepDueLabel(next, today)}
          {rest > 0 ? ` · ${rest} more` : ""}
        </p>
        <p className={styles.nudgeTask}>{next.description}</p>
      </div>
      <Button loading={complete.isPending} icon={<Icon name="check" />} onClick={() => complete.mutate(next.id)}>
        Done
      </Button>
    </section>
  );
}
