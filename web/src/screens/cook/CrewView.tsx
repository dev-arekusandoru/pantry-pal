import { Button, Icon, cx } from "@/ui";
import { stepSeconds } from "../recipe/duration";
import type { RecipeStepLink } from "../recipe/lib";
import { assignedSteps, type CookStep, type Crew } from "./crew";
import type { StepPill } from "./stepPills";
import { StepPills } from "./StepPillList";
import { StepTimerRow, type StepTimers } from "./StepTimerRow";
import styles from "./CookScreen.module.css";

/** One panel per cook: their own step, timer and navigation. */
export function CrewPanels({
  crew,
  steps,
  timers,
  pillsFor,
  onMove,
  onDone,
  onReopen,
}: {
  crew: Crew;
  steps: readonly CookStep[];
  timers: StepTimers;
  pillsFor: (links: RecipeStepLink[]) => StepPill[];
  onMove: (cookId: string, delta: number) => void;
  onDone: (cookId: string) => void;
  onReopen: (cookId: string) => void;
}) {
  return (
    <div className={cx(styles.crewGrid, crew.cooks.length > 2 && styles.crewGridQuad)}>
      {crew.cooks.map((cook) => {
        const owned = assignedSteps(crew.owners, cook.id);
        const position = Math.min(crew.positions[cook.id] ?? 0, owned.length);
        const stepIndex = owned[position];
        const step = stepIndex !== undefined ? steps[stepIndex] : undefined;
        const seconds = step !== undefined ? stepSeconds(step) : null;

        return (
          <section key={cook.id} className={styles.panel} aria-label={cook.name}>
            <header className={styles.panelHead}>
              <h2>{cook.name}</h2>
              {stepIndex !== undefined && (
                <p>
                  Step {stepIndex + 1} · {position + 1} of {owned.length}
                </p>
              )}
            </header>

            {stepIndex === undefined || step === undefined ? (
              <>
                <p className={styles.panelDone}>{cook.name} is done</p>
                <div className={styles.panelActions}>
                  <Button
                    icon={<Icon name="back" />}
                    disabled={owned.length === 0}
                    onClick={() => onReopen(cook.id)}
                  >
                    Back
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className={styles.panelBody}>
                  {step.groupLabel && <p className={styles.group}>{step.groupLabel}</p>}
                  <p className={styles.panelText}>{step.text}</p>
                  <StepPills pills={pillsFor(step.links)} />
                  {seconds !== null && <StepTimerRow index={stepIndex} seconds={seconds} timers={timers} />}
                </div>
                <div className={styles.panelActions}>
                  <Button icon={<Icon name="back" />} disabled={position === 0} onClick={() => onMove(cook.id, -1)}>
                    Back
                  </Button>
                  {position + 1 >= owned.length ? (
                    <Button
                      variant="primary"
                      className={styles.next}
                      icon={<Icon name="check" />}
                      onClick={() => onDone(cook.id)}
                    >
                      Done
                    </Button>
                  ) : (
                    <Button variant="primary" className={styles.next} onClick={() => onMove(cook.id, 1)}>
                      Next
                    </Button>
                  )}
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
