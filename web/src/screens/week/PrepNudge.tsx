import { Button, Icon } from "@/ui";
import { pickNextPrep, prepDueLabel, type PrepTask } from "./model";
import { useCompletePrepTask } from "./queries";
import styles from "./Week.module.css";

interface PrepNudgeProps {
  tasks: readonly PrepTask[];
  today: string;
}

/** The next prep task with a one-tap "Done". Renders nothing when there is none. */
export function PrepNudge({ tasks, today }: PrepNudgeProps) {
  const complete = useCompletePrepTask();
  const picked = pickNextPrep(tasks, today);
  if (!picked) return null;
  const { next, rest } = picked;

  return (
    <section className={styles.nudge} aria-label="Next prep task">
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
