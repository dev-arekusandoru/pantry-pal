import { Button, Emoji, Icon, Stepper, toast } from "@/ui";
import { addDays, weekdayName } from "../../../dates";
import { MEAL_LABEL } from "../../../model";
import { DEFAULT_EAT_SERVINGS, moveCook, removeBatch, removeEat, setServings, addEat, type Draft } from "../../draft";
import { firstEatDate, recipeIcon, restoreBatch, restoreEat } from "../../model";
import styles from "./mobile.module.css";

interface BatchSheetProps {
  batchId: string | null;
  /** The eat the sheet was opened from; null = opened from the cook-night chip. */
  eatId: string | null;
  draft: Draft;
  setDraft: (fn: (d: Draft) => Draft) => void;
  onClose: () => void;
}

/** Servings, cook day and the other meals this cook feeds, as a bottom sheet. */
export function BatchSheet({ batchId, eatId, draft, setDraft, onClose }: BatchSheetProps) {
  const batch = batchId ? draft.batches.find((b) => b.id === batchId) : undefined;
  if (!batch) return null;
  const eat = batch.eats.find((e) => e.id === eatId);
  const meal = eat?.mealType ?? batch.eats[0]?.mealType ?? "dinner";
  const days = draft.days;
  const before = addDays(days[0] ?? batch.cookDate, -1);
  const first = firstEatDate(batch);
  const lone = batch.eats.length === 1;
  const auto = batch.eats.reduce((n, e) => n + (e.servings ?? DEFAULT_EAT_SERVINGS), 0);

  const remove = () => {
    onClose();
    if (eat) {
      setDraft((d) => removeEat(d, batch.id, eat.id));
      toast.show({
        message: `Removed ${batch.title} from ${weekdayName(eat.date)} ${MEAL_LABEL[eat.mealType]}`,
        action: { label: "Undo", onClick: () => setDraft((d) => restoreEat(d, batch, eat)) },
      });
    } else {
      setDraft((d) => removeBatch(d, batch.id));
      toast.show({
        message: `Removed ${batch.title} and its ${batch.eats.length === 1 ? "meal" : `${batch.eats.length} meals`}`,
        action: { label: "Undo", onClick: () => setDraft((d) => restoreBatch(d, batch)) },
      });
    }
  };

  return (
    <div className={styles.batchSheet}>
      <div className={styles.popHead}>
        <Emoji code={recipeIcon(batch.title)} size={38} />
        <div>
          <p className={styles.popTitle}>{batch.title}</p>
          <p className={styles.popSub}>One cook, as many meals as you like.</p>
        </div>
      </div>

      <div className={styles.stepperRow}>
        <Stepper
          label="Servings"
          value={batch.servings}
          unit="servings"
          onDecrement={() => setDraft((d) => setServings(d, batch.id, Math.max(1, batch.servings - 1)))}
          onIncrement={() => setDraft((d) => setServings(d, batch.id, batch.servings + 1))}
          disableDecrement={batch.servings <= 1}
        />
        {batch.servingsSet ? (
          <button type="button" className={styles.linkBtn} onClick={() => setDraft((d) => setServings(d, batch.id, null))}>
            Back to auto ({auto})
          </button>
        ) : (
          <span className={styles.chipSub}>auto: adds up your meals</span>
        )}
      </div>

      <fieldset className={styles.popField}>
        <legend>Cook on</legend>
        <div className={styles.dayChips}>
          {[before, ...days].map((d) => {
            const on = batch.cookDate === d;
            return (
              <button
                key={d}
                type="button"
                className={styles.dayChip}
                aria-pressed={on}
                disabled={d > first}
                aria-label={`Cook on ${weekdayName(d)} ${Number(d.slice(8))}${d === before ? " (before the week)" : ""}`}
                onClick={() => setDraft((x) => moveCook(x, batch.id, d))}
              >
                {on && <Icon name="check" size={12} />}
                <span>{weekdayName(d, "short")}</span>
                <b>{Number(d.slice(8))}</b>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className={styles.popField}>
        <legend>Also eat on ({MEAL_LABEL[meal].toLowerCase()})</legend>
        <div className={styles.dayChips}>
          {days.map((d) => {
            const here = batch.eats.some((e) => e.date === d && e.mealType === meal);
            return (
              <button
                key={d}
                type="button"
                className={styles.dayChip}
                aria-pressed={here}
                disabled={here && lone}
                aria-label={`${here ? "Stop eating" : "Also eat"} ${batch.title} on ${weekdayName(d)} ${meal}`}
                onClick={() => {
                  const target = batch.eats.find((e) => e.date === d && e.mealType === meal);
                  setDraft((x) => (target ? removeEat(x, batch.id, target.id) : addEat(x, batch.id, d, meal)));
                }}
              >
                {here && <Icon name="check" size={12} />}
                <span>{weekdayName(d, "short")}</span>
                <b>{Number(d.slice(8))}</b>
              </button>
            );
          })}
        </div>
      </fieldset>

      <Button variant="dangerGhost" icon={<Icon name="trash" />} onClick={remove}>
        {eat ? "Remove this meal" : "Remove batch"}
      </Button>
    </div>
  );
}
