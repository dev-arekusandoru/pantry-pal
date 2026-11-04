import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button, Icon, Pill, SearchInput, Sheet, Skeleton, toast } from "@/ui";
import { monthDay, weekdayName } from "./dates";
import { MEAL_EMOJI, pantryCoverage, slotName, swapPlanFor, type AvailabilityLine, type MealType, type PlanView, type RecipeSummary, type Slot } from "./model";
import { Plate } from "./Plate";
import { useAvailability, usePickerRecipes, useRecipeIngredients, useSwapMeal } from "./queries";
import styles from "./SwapSheet.module.css";

/** Which meal is being changed. `slot` is null for an empty meal with no slot yet. */
export interface SwapTarget {
  date: string;
  mealType: MealType;
  slot: Slot | null;
}

interface SwapSheetProps {
  target: SwapTarget | null;
  plan: PlanView;
  onClose: () => void;
}

export function SwapSheet({ target, plan, onClose }: SwapSheetProps) {
  if (!target) return null;
  return <SwapSheetBody key={`${target.date}-${target.mealType}-${target.slot?.id ?? "new"}`} target={target} plan={plan} onClose={onClose} />;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function SwapSheetBody({ target, plan, onClose }: SwapSheetProps & { target: SwapTarget }) {
  const navigate = useNavigate();
  const swap = useSwapMeal(plan.id);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<RecipeSummary | null>(null);
  const recipes = usePickerRecipes(target.mealType, useDebounced(search, 250));
  const availability = useAvailability(true);

  const { slot, date, mealType } = target;
  const { askScope, fed } = slot ? swapPlanFor(slot, plan) : { askScope: false, fed: [] };

  function submit(recipe: RecipeSummary, scope: "this" | "with_leftovers") {
    swap.mutate(
      { slot: slot ? { id: slot.id } : { date, mealType }, recipeId: recipe.id, scope },
      {
        onSuccess: ({ shoppingListStale }) => {
          onClose();
          if (shoppingListStale) {
            toast.show({
              message: "Your plan changed. Update the shopping list",
              action: { label: "Update", onClick: () => void navigate({ to: "/shop" }) },
            });
          }
        },
      },
    );
  }

  function pick(recipe: RecipeSummary) {
    if (askScope) setChosen(recipe);
    else submit(recipe, "this");
  }

  const title = `${slot ? "Swap" : "Plan"} ${weekdayName(date)} ${mealType}`;
  const current = slot?.cookEvent?.recipeTitle ?? slot?.label;

  return (
    <Sheet open onClose={onClose} title={title}>
      <p className={styles.sub}>
        {weekdayName(date)}, {monthDay(date)}
        {current ? ` · now ${current}` : ""}
      </p>
      {chosen && slot ? (
        <ScopeChoice
          recipe={chosen}
          slot={slot}
          fed={fed}
          busy={swap.isPending}
          onChoose={(scope) => submit(chosen, scope)}
          onBack={() => setChosen(null)}
        />
      ) : (
        <>
          <SearchInput label={`Search ${mealType} recipes`} value={search} onChange={setSearch} className={styles.search} />
          {recipes.isError ? (
            <p className={styles.note} role="alert">
              Couldn't load recipes. Try again in a moment.
            </p>
          ) : recipes.isPending ? (
            <div className={styles.list} aria-busy="true">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={96} radius={24} />
              ))}
            </div>
          ) : recipes.data.length === 0 ? (
            <p className={styles.note}>{search.trim() ? "No recipes match that search." : `No ${mealType} recipes yet.`}</p>
          ) : (
            <ul className={styles.list}>
              {recipes.data.map((recipe) => (
                <li key={recipe.id}>
                  <PickerRow
                    recipe={recipe}
                    mealType={mealType}
                    availability={availability.data}
                    disabled={swap.isPending}
                    onPick={pick}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Sheet>
  );
}

interface ScopeChoiceProps {
  recipe: RecipeSummary;
  slot: Slot;
  fed: Slot[];
  busy: boolean;
  onChoose: (scope: "this" | "with_leftovers") => void;
  onBack: () => void;
}

function ScopeChoice({ recipe, slot, fed, busy, onChoose, onBack }: ScopeChoiceProps) {
  const cookTitle = slot.cookEvent?.recipeTitle ?? "This meal";
  return (
    <div className={styles.scope}>
      <p className={styles.scopeIntro}>
        {cookTitle} feeds {fed.length} meals. Switch to <b>{recipe.title}</b> for&hellip;
      </p>
      <button type="button" className={styles.option} disabled={busy} onClick={() => onChoose("this")}>
        <b>Just this meal</b>
        <span>{slotName(slot)} changes. The other meals keep {cookTitle}.</span>
      </button>
      <button type="button" className={styles.option} disabled={busy} onClick={() => onChoose("with_leftovers")}>
        <b>This and its leftovers</b>
        <span>{fed.map(slotName).join(", ")} all switch.</span>
      </button>
      <Button variant="ghost" onClick={onBack} disabled={busy} icon={<Icon name="back" />}>
        Pick another recipe
      </Button>
    </div>
  );
}

/** Resolves once the row scrolls into view, so the pantry lookup only runs for rows that are seen. */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

interface PickerRowProps {
  recipe: RecipeSummary;
  mealType: MealType;
  availability: ReadonlyMap<string, AvailabilityLine> | undefined;
  disabled: boolean;
  onPick: (recipe: RecipeSummary) => void;
}

function PickerRow({ recipe, mealType, availability, disabled, onPick }: PickerRowProps) {
  const [ref, seen] = useSeen<HTMLButtonElement>();
  return (
    <button ref={ref} type="button" className={styles.row} disabled={disabled} onClick={() => onPick(recipe)}>
      <span className={styles.thumb}>
        <Plate imageUrl={recipe.imageUrl} emoji={MEAL_EMOJI[mealType]} />
      </span>
      <span className={styles.rowBody}>
        <span className={styles.rowTitle}>{recipe.title}</span>
        {recipe.totalMinutes !== null && (
          <span className={styles.meta}>
            <Icon name="clock" size={15} /> {recipe.totalMinutes} min
          </span>
        )}
        <span className={styles.pills}>
          <PantryFit slug={recipe.slug} enabled={seen} availability={availability} />
        </span>
      </span>
    </button>
  );
}

function PantryFit({ slug, enabled, availability }: { slug: string; enabled: boolean; availability: PickerRowProps["availability"] }) {
  const ingredients = useRecipeIngredients(slug, enabled);
  if (!availability || ingredients.isError) return null;
  if (!ingredients.data) return <Skeleton width={96} height={24} radius={999} />;
  const { have, total } = pantryCoverage(ingredients.data, availability);
  if (total === 0) return null;
  return (
    <Pill tone={have === total ? "pistachio" : "neutral"}>
      {have === total ? "Pantry has it all" : `Pantry has ${have} of ${total}`}
    </Pill>
  );
}
