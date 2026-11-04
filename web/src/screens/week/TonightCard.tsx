import { Link } from "@tanstack/react-router";
import { Button, Icon, Pill, buttonClass, toast } from "@/ui";
import { useUndoCook } from "../cook/queries";
import { recipeSlug } from "./DayCard";
import { weekdayName } from "./dates";
import { MEAL_EMOJI, slotName, slotNote, slotState, swapPlanFor, tonightSlot, type PlanView, type RecipeSummary } from "./model";
import { Plate } from "./Plate";
import type { SwapTarget } from "./SwapSheet";
import styles from "./Week.module.css";

interface TonightCardProps {
  plan: PlanView;
  today: string;
  recipes: ReadonlyMap<string, RecipeSummary> | undefined;
  onSwap: (target: SwapTarget) => void;
}

/** Null when today is outside the plan week. */
export function TonightCard({ plan, today, recipes, onSwap }: TonightCardProps) {
  if (!plan.days.some((d) => d.date === today)) return null;
  const slot = tonightSlot(plan, today);
  const target: SwapTarget = { date: today, mealType: "dinner", slot };

  const cook = slot?.cookEvent;
  if (!slot || !cook) {
    const text = !slot ? "Nothing planned for dinner" : slot.kind === "skip" ? (slot.label ?? "No dinner planned") : (slot.label ?? "Something simple");
    return (
      <section className={styles.tonightPlain} aria-label="Dinner tonight">
        <p className={styles.kicker}>Dinner tonight</p>
        <h2 className={styles.tonightTitle}>{text}</h2>
        <div className={styles.actions}>
          <Button variant="primary" icon={<Icon name="plus" />} onClick={() => onSwap(target)}>
            {slot ? "Pick a recipe" : "Plan something"}
          </Button>
        </div>
      </section>
    );
  }

  const recipe = recipes?.get(cook.recipeId);
  const slug = recipeSlug(recipes, cook.recipeId);
  const state = slotState(slot);
  const undo = useUndoCook();
  const planned = cook.status === "planned";
  const cookView = plan.cookEvents.find((c) => c.id === cook.id);
  const servings = cookView?.plannedServings;
  const { canSwap } = swapPlanFor(slot, plan);
  const note = slotNote(slot, plan);

  return (
    <section className={styles.tonight} aria-label="Dinner tonight">
      <Plate imageUrl={recipe?.imageUrl} emoji={MEAL_EMOJI.dinner} className={styles.tonightPlate} />
      <div className={styles.tonightBody}>
        <p className={styles.kicker}>Dinner tonight</p>
        <h2 className={styles.tonightTitle}>{cook.recipeTitle}</h2>
        <p className={styles.tonightMeta}>
          {recipe?.totalMinutes != null && (
            <span className={styles.metaItem}>
              <Icon name="clock" size={17} />
              {recipe.totalMinutes} min
            </span>
          )}
          {slot.isLeftover ? (
            <Pill tone="peach" icon={<Icon name="leftover" />}>
              Leftovers from {weekdayName(cook.cookDate)}
            </Pill>
          ) : (
            <>
              {servings !== undefined && (
                <span className={styles.metaItem}>
                  <Icon name="people" size={17} />
                  Cooks {servings}
                </span>
              )}
              {note && (
                <span className={styles.metaItem}>
                  <Icon name="leftover" size={17} />
                  {note}
                </span>
              )}
            </>
          )}
          {state === "done" && (
            <Pill tone="pistachio" icon={<Icon name="check" />}>
              Cooked
            </Pill>
          )}
          {state === "skipped" && <Pill>Skipped</Pill>}
        </p>
        <div className={styles.actions}>
          {planned && !slot.isLeftover && (
            <Link
              to="/recipes/$slug/cook"
              params={{ slug }}
              search={{ cookEvent: cook.id, ...(servings !== undefined ? { servings } : {}), from: "week" }}
              className={buttonClass({ variant: "primary" })}
            >
              <Icon name="flame" />
              Start cooking
            </Link>
          )}
          <Link
            to="/recipes/$slug"
            params={{ slug }}
            search={planned ? { cookEvent: cook.id } : {}}
            className={buttonClass()}
          >
            View recipe
          </Link>
          {canSwap && (
            <Button variant="ghost" icon={<Icon name="swap" />} onClick={() => onSwap(target)} aria-label={`Swap ${slotName(slot)}`}>
              Swap
            </Button>
          )}
          {state === "done" && (
            <Button
              variant="ghost"
              icon={<Icon name="undo" />}
              loading={undo.isPending}
              onClick={() =>
                undo.mutate(cook.id, {
                  onSuccess: () => toast.show({ message: "Cook undone. Pantry restored." }),
                })
              }
            >
              Undo
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
