import { Fragment } from "react";
import { Button, Icon, IconButton, Sheet } from "@/ui";
import { MAX_COOKS, assignGroup, stepGroups, type CookStep, type CrewCook } from "./crew";
import styles from "./CookScreen.module.css";

/** Toggle chip shared by the picker and both assignment rows. */
function CookChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button type="button" className={styles.cookChip} aria-pressed={active} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** "Who's cooking?": pick two to four household members before assigning steps. */
export function WhoCookingSheet({
  open,
  cooks,
  selected,
  onToggle,
  onClose,
  onJustMe,
  onNext,
}: {
  open: boolean;
  /** Pickable members, plus any saved cook who is no longer in the household. */
  cooks: CrewCook[];
  selected: CrewCook[];
  onToggle: (cook: CrewCook) => void;
  onClose: () => void;
  onJustMe: () => void;
  onNext: () => void;
}) {
  const full = selected.length >= MAX_COOKS;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Who's cooking?"
      footer={
        <>
          <Button onClick={onJustMe}>Just me</Button>
          <Button variant="primary" disabled={selected.length < 2} onClick={onNext}>
            Next
          </Button>
        </>
      }
    >
      <div className={styles.cookPicker} role="group" aria-label="Cooks">
        {cooks.map((cook) => {
          const active = selected.some((chosen) => chosen.id === cook.id);
          return (
            <CookChip
              key={cook.id}
              active={active}
              disabled={!active && full}
              onClick={() => onToggle(cook)}
            >
              {cook.name}
            </CookChip>
          );
        })}
      </div>
      <p className={styles.pickHint}>
        {full ? "That is four cooks: one per corner of the screen." : "Pick up to four. Each cook gets their own steps."}
      </p>
    </Sheet>
  );
}

/** "Assign steps": every step with its own cook chips, plus whole-group chips. */
export function AssignSteps({
  steps,
  cooks,
  owners,
  onChange,
  onBack,
  onStart,
  onExit,
}: {
  steps: readonly CookStep[];
  cooks: readonly CrewCook[];
  owners: string[];
  onChange: (owners: string[]) => void;
  onBack: () => void;
  onStart: () => void;
  onExit: () => void;
}) {
  const groups = stepGroups(steps);
  const groupStarts = new Set(groups.map((group) => group.start));

  function assignStep(index: number, cookId: string) {
    const next = [...owners];
    next[index] = cookId;
    onChange(next);
  }

  return (
    <div className={styles.cook}>
      <header className={styles.top}>
        <IconButton className={styles.round} label="Exit cook mode" icon={<Icon name="close" />} onClick={onExit} />
        <div className={styles.title}>
          <h1>Assign steps</h1>
          <span>Tap a name for each step</span>
        </div>
        <span className={styles.topSpacer} aria-hidden="true" />
      </header>

      <main className={styles.assignMain}>
        {steps.map((step, index) => (
          <Fragment key={step.id}>
            {step.groupLabel !== null && groupStarts.has(index) && (
              <div className={styles.assignGroup}>
                <p>{step.groupLabel}</p>
                <div className={styles.cookChips} role="group" aria-label={`Cook for all ${step.groupLabel} steps`}>
                  {cooks.map((cook) => (
                    <CookChip
                      key={cook.id}
                      active={owners[index] === cook.id}
                      onClick={() => onChange(assignGroup(owners, steps, index, cook.id))}
                    >
                      {cook.name}
                    </CookChip>
                  ))}
                </div>
              </div>
            )}
            <div className={styles.assignRow}>
              <p className={styles.assignText}>
                <b>{index + 1}</b>
                {step.text}
              </p>
              <div className={styles.cookChips} role="group" aria-label={`Cook for step ${index + 1}`}>
                {cooks.map((cook) => (
                  <CookChip key={cook.id} active={owners[index] === cook.id} onClick={() => assignStep(index, cook.id)}>
                    {cook.name}
                  </CookChip>
                ))}
              </div>
            </div>
          </Fragment>
        ))}
      </main>

      <footer className={styles.foot}>
        <Button size="lg" icon={<Icon name="back" />} onClick={onBack}>
          Back
        </Button>
        <Button size="lg" variant="primary" className={styles.next} icon={<Icon name="check" />} onClick={onStart}>
          Start cooking
        </Button>
      </footer>
    </div>
  );
}
