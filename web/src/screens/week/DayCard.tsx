import { Link, useNavigate } from "@tanstack/react-router";
import { Icon, IconButton, Sticker, cx, toast } from "@/ui";
import { useUndoCook } from "../cook/queries";
import { monthDay, weekdayName } from "./dates";
import {
  MEAL_EMOJI,
  MEAL_LABEL,
  canAddDish,
  canRemoveDish,
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
import { useRemoveDish } from "./queries";
import { showStaleListToast, type SwapTarget } from "./SwapSheet";
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
    <li
      className={cx(styles.day, isToday && styles.isToday)}
      data-ui="day"
      aria-current={isToday ? "date" : undefined}
    >
      <div className={styles.dayName} data-ui="day-name">
        <h3 className={styles.dayShort}>{weekdayName(day.date)}</h3>
        <span className={styles.dayDate}>{monthDay(day.date)}</span>
        {isToday && <span className={styles.todayFlag}>Today</span>}
      </div>
      <ul className={styles.slots} data-ui="day-slots">
        {mealGroups(day).flatMap(({ mealType, slots }) =>
          slots.length === 0 ? (
            <li key={mealType} className={styles.slot} data-ui="slot">
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
            slots.map((slot, i) => (
              <SlotRow
                key={slot.id}
                slot={slot}
                plan={plan}
                recipes={recipes}
                onSwap={onSwap}
                isSide={i > 0}
                canRemove={slots.length > 1 && canRemoveDish(slot)}
                canAdd={i === slots.length - 1 && canAddDish(slots)}
              />
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
  /** A later dish of the same meal (e.g. a side): no sticker or meal name of its own. */
  isSide: boolean;
  canRemove: boolean;
  /** The meal's last dish carries the button that adds another one. */
  canAdd: boolean;
}

function SlotRow({ slot, plan, recipes, onSwap, isSide, canRemove, canAdd }: SlotRowProps) {
  const { mealType, date } = slot;
  const cook = slot.cookEvent;
  const state = slotState(slot);
  const note = slotNote(slot, plan);
  const { canSwap } = swapPlanFor(slot, plan);
  const { tone, tilt } = MEAL_STICKER[mealType];
  const openSwap = () => onSwap({ date, mealType, slot });
  const undo = useUndoCook();
  const remove = useRemoveDish(plan.id);
  const navigate = useNavigate();
  const title = cook?.recipeTitle ?? slot.label ?? (slot.kind === "skip" ? "No meal planned" : "Something simple");

  function undoCook() {
    if (!cook) return;
    undo.mutate(cook.id, {
      onSuccess: () => toast.show({ message: "Cook undone. Pantry restored." }),
    });
  }

  function removeDish() {
    remove.mutate(slot.id, {
      onSuccess: ({ shoppingListStale }) => {
        if (shoppingListStale) showStaleListToast(() => void navigate({ to: "/shop" }));
        else toast.show({ message: `${title} removed from ${slotName(slot)}.` });
      },
    });
  }

  const label = (
    <>
      {isSide ? (
        <span aria-hidden="true" className={styles.sideMark} />
      ) : (
        <Sticker emoji={MEAL_EMOJI[mealType]} tone={tone} tilt={tilt} />
      )}
      <span className={styles.slotBody}>
        <span className={styles.slotMeal}>
          {isSide ? "With" : MEAL_LABEL[mealType]}
          {state === "done" && (
            <span className={styles.stateTag}>
              <Icon name="check" size={13} /> Cooked
            </span>
          )}
          {state === "skipped" && <span className={styles.stateTag}>Skipped</span>}
        </span>
        <span className={styles.slotTitle}>{title}</span>
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
    <li
      className={cx(
        styles.slot,
        isSide && styles.side,
        slot.isLeftover && styles.leftover,
        state !== "planned" && styles[state],
      )}
      data-ui="slot"
    >
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
      {state === "done" && cook && (
        <IconButton
          variant="plain"
          label={`Undo ${slotName(slot)} cooked`}
          icon={<Icon name="undo" />}
          disabled={undo.isPending}
          onClick={undoCook}
        />
      )}
      {canRemove && (
        <IconButton
          variant="plain"
          label={`Remove ${title} from ${slotName(slot)}`}
          icon={<Icon name="trash" />}
          disabled={remove.isPending}
          onClick={removeDish}
        />
      )}
      {/* A row without a cook already opens the swap sheet; only linked rows need the icon. */}
      {canSwap && cook && (
        <IconButton
          variant="plain"
          label={`Swap ${isSide ? title : slotName(slot)}`}
          icon={<Icon name="swap" />}
          onClick={openSwap}
        />
      )}
      {canAdd && (
        <IconButton
          variant="plain"
          label={`Add a dish to ${slotName(slot)}`}
          icon={<Icon name="plus" />}
          onClick={() => onSwap({ date, mealType, slot: null, add: true })}
        />
      )}
    </li>
  );
}
