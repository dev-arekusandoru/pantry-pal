import { Link } from "@tanstack/react-router";
import { Icon, IconButton, Sticker, cx } from "@/ui";
import { monthDay, weekdayName } from "./dates";
import {
  MEAL_EMOJI,
  MEAL_LABEL,
  mealGroups,
  slotName,
  slotNote,
  slotState,
  swapPlanFor,
  type MealType,
  type PlanDay,
  type PlanView,
  type RecipeSummary,
  type Slot,
} from "./model";
import type { SwapTarget } from "./SwapSheet";
import styles from "./Week.module.css";

const MEAL_STICKER: Record<MealType, { tone: "peach" | "pistachio" | "blue" | "gum" | "butter"; tilt: number }> = {
  breakfast: { tone: "peach", tilt: -6 },
  lunch: { tone: "pistachio", tilt: 5 },
  dinner: { tone: "blue", tilt: -3 },
  snack: { tone: "gum", tilt: 4 },
  dessert: { tone: "butter", tilt: -4 },
};

/** Recipe link target: id when the recipe is missing from the index (the API accepts either). */
export function recipeSlug(recipes: ReadonlyMap<string, RecipeSummary> | undefined, recipeId: string): string {
  return recipes?.get(recipeId)?.slug ?? recipeId;
}

interface DayCardProps {
  day: PlanDay;
  plan: PlanView;
  today: string;
  recipes: ReadonlyMap<string, RecipeSummary> | undefined;
  onSwap: (target: SwapTarget) => void;
}

export function DayCard({ day, plan, today, recipes, onSwap }: DayCardProps) {
  const isToday = day.date === today;
  return (
    <li className={cx(styles.day, isToday && styles.isToday)} aria-current={isToday ? "date" : undefined}>
      <div className={styles.dayName}>
        <h3 className={styles.dayShort}>{weekdayName(day.date)}</h3>
        <span className={styles.dayDate}>{monthDay(day.date)}</span>
        {isToday && <span className={styles.todayFlag}>Today</span>}
      </div>
      <ul className={styles.slots}>
        {mealGroups(day).flatMap(({ mealType, slots }) =>
          slots.length === 0 ? (
            <li key={mealType} className={styles.slot}>
              <button
                type="button"
                className={cx(styles.slotMain, styles.planBtn)}
                onClick={() => onSwap({ date: day.date, mealType, slot: null })}
              >
                <span className={styles.slotMealFixed}>{MEAL_LABEL[mealType]}</span>
                <span className={styles.slotAdd}>
                  <Icon name="plus" />
                  Plan something
                </span>
              </button>
            </li>
          ) : (
            slots.map((slot) => (
              <SlotRow key={slot.id} slot={slot} plan={plan} recipes={recipes} onSwap={onSwap} />
            ))
          ),
        )}
      </ul>
    </li>
  );
}

interface SlotRowProps {
  slot: Slot;
  plan: PlanView;
  recipes: ReadonlyMap<string, RecipeSummary> | undefined;
  onSwap: (target: SwapTarget) => void;
}

function SlotRow({ slot, plan, recipes, onSwap }: SlotRowProps) {
  const { mealType, date } = slot;
  const cook = slot.cookEvent;
  const state = slotState(slot);
  const note = slotNote(slot, plan);
  const { canSwap } = swapPlanFor(slot, plan);
  const { tone, tilt } = MEAL_STICKER[mealType];
  const openSwap = () => onSwap({ date, mealType, slot });

  const label = (
    <>
      <Sticker emoji={MEAL_EMOJI[mealType]} tone={tone} tilt={tilt} />
      <span className={styles.slotBody}>
        <span className={styles.slotMeal}>
          {MEAL_LABEL[mealType]}
          {state === "done" && (
            <span className={styles.stateTag}>
              <Icon name="check" size={13} /> Cooked
            </span>
          )}
          {state === "skipped" && <span className={styles.stateTag}>Skipped</span>}
        </span>
        <span className={styles.slotTitle}>
          {cook?.recipeTitle ?? slot.label ?? (slot.kind === "skip" ? "No meal planned" : "Something simple")}
        </span>
        {note && (
          <span className={styles.slotNote}>
            {slot.isLeftover && <Icon name="leftover" />}
            {note}
          </span>
        )}
        {!cook && slot.kind === "freeform" && <span className={styles.slotNote}>Not a recipe</span>}
      </span>
    </>
  );

  return (
    <li className={cx(styles.slot, slot.isLeftover && styles.leftover, state !== "planned" && styles[state])}>
      {cook ? (
        <Link
          to="/recipes/$slug"
          params={{ slug: recipeSlug(recipes, cook.recipeId) }}
          search={cook.status === "planned" ? { cookEvent: cook.id } : {}}
          className={styles.slotMain}
        >
          {label}
        </Link>
      ) : (
        <button type="button" className={styles.slotMain} onClick={openSwap}>
          {label}
        </button>
      )}
      {canSwap && (
        <IconButton
          variant="plain"
          label={`Swap ${slotName(slot)}`}
          icon={<Icon name="swap" />}
          onClick={openSwap}
        />
      )}
    </li>
  );
}
