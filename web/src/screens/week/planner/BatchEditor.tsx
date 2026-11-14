import { Popover } from "radix-ui";
import { Button, Emoji, Icon, Stepper } from "@/ui";
import { addDays, weekdayName } from "../dates";
import { MEAL_LABEL } from "../model";
import { DEFAULT_EAT_SERVINGS } from "./draft";
import type { DraftBatch } from "./draft";
import styles from "./Planner.module.css";
import { useGrid } from "./ctx";
import { firstEatDate, recipeIcon } from "./model";

/** Servings, cook day and eat days for one batch. Hangs off the chip that opened it. */
export function BatchEditor({ batch, eatKey, fresh }: { batch: DraftBatch; eatKey: string; fresh: boolean }) {
  const g = useGrid();
  const eat = batch.eats.find((e) => e.id === eatKey);
  const meal = eat?.mealType ?? batch.eats[0]?.mealType ?? "dinner";
  const first = firstEatDate(batch);
  const auto = batch.eats.reduce((n, e) => n + (e.servings ?? DEFAULT_EAT_SERVINGS), 0);
  const days = g.draft.days;
  const before = addDays(days[0] ?? batch.cookDate, -1);
  const lone = batch.eats.length === 1;

  return (
    <>
      <div className={styles.popHead}>
        <Emoji code={recipeIcon(batch.title)} size={40} />
        <div className={styles.popTitleBox}>
          <p className={styles.popTitle}>{batch.title}</p>
          <p className={styles.popSub}>{fresh ? "Added to your plan. Tweak it, or just carry on." : "One cook, as many meals as you like."}</p>
        </div>
        <Popover.Close className={styles.popClose} aria-label="Close">
          <Icon name="close" size={16} />
        </Popover.Close>
      </div>

      <div className={styles.popRow}>
        <Stepper
          label="Servings"
          value={batch.servings}
          unit="servings"
          onDecrement={() => g.setServings(batch.id, Math.max(1, batch.servings - 1))}
          onIncrement={() => g.setServings(batch.id, batch.servings + 1)}
          disableDecrement={batch.servings <= 1}
        />
        {batch.servingsSet ? (
          <button type="button" className={styles.linkBtn} onClick={() => g.setServings(batch.id, null)}>
            Back to auto ({auto})
          </button>
        ) : (
          <span className={styles.chipNote}>auto: adds up your meals</span>
        )}
      </div>

      <fieldset className={styles.popField}>
        <legend>Cook on</legend>
        <div className={styles.dayChips}>
          {[before, ...days].map((d) => {
            const late = d > first;
            const on = batch.cookDate === d;
            return (
              <button
                key={d}
                type="button"
                className={styles.dayChip}
                aria-pressed={on}
                disabled={late}
                title={late ? "A cook day can't come after the first meal" : d === before ? "The day before the week starts" : undefined}
                aria-label={`Cook on ${weekdayName(d)} ${Number(d.slice(8))}${d === before ? " (before the week)" : ""}`}
                onClick={() => g.setCook(batch.id, d)}
              >
                {on && <Icon name="check" size={12} />}
                <span>{weekdayName(d, "short")}</span>
                <b>{Number(d.slice(8))}</b>
                {d === before && <span aria-hidden="true">‹</span>}
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
                onClick={() => g.toggleEat(batch, d, meal)}
              >
                {here && <Icon name="check" size={12} />}
                <span>{weekdayName(d, "short")}</span>
                <b>{Number(d.slice(8))}</b>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className={styles.popActions}>
        <Button
          variant="secondary"
          icon={<Icon name="swap" />}
          onClick={() => g.startMove(eat ? { type: "eat", batchId: batch.id, eatId: eat.id } : { type: "cook", batchId: batch.id })}
        >
          {eat ? "Move this meal" : "Move cook day"}
        </Button>
        <Button
          variant="dangerGhost"
          icon={<Icon name="trash" />}
          onClick={() => {
            g.edit(null);
            if (eat) g.removeEat(batch, eat);
            else g.removeBatch(batch);
          }}
        >
          {eat ? "Remove meal" : "Remove batch"}
        </Button>
      </div>
    </>
  );
}
