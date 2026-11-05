import { useNavigate } from "@tanstack/react-router";
import { ToggleGroup, VisuallyHidden } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
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
  // Announced politely so screen readers hear the list change as the search narrows.
  const resultCount = recipes.isError
    ? "Couldn't load recipes"
    : recipes.isPending
      ? "Loading recipes"
      : `${recipes.data.length} ${recipes.data.length === 1 ? "recipe" : "recipes"}`;

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
          <VisuallyHidden.Root role="status">{resultCount}</VisuallyHidden.Root>
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
            <ToggleGroup.Root
              type="single"
              // One tap applies the pick, so the group reports activations instead of holding a
              // checked item (a stuck check would also make a failed submit impossible to retry).
              value=""
              className={styles.list}
              aria-label={`Pick a ${mealType} recipe`}
              aria-orientation="vertical"
              disabled={swap.isPending}
              onValueChange={(value) => {
                const recipe = recipes.data.find((r) => r.id === value);
                if (recipe) pick(recipe);
              }}
            >
              {recipes.data.map((recipe) => (
                <PickerRow key={recipe.id} recipe={recipe} mealType={mealType} availability={availability.data} />
              ))}
            </ToggleGroup.Root>
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
  const introId = useId();
  return (
    <div className={styles.scope}>
      <p className={styles.scopeIntro} id={introId}>
        {cookTitle} feeds {fed.length} meals. Switch to <b>{recipe.title}</b> for&hellip;
      </p>
      <ToggleGroup.Root
        type="single"
        // See the picker group: activation applies the scope, it is not a stored selection.
        value=""
        className={styles.scopeOptions}
        aria-labelledby={introId}
        aria-orientation="vertical"
        disabled={busy}
        onValueChange={(scope) => {
          if (scope === "this" || scope === "with_leftovers") onChoose(scope);
        }}
      >
        <ToggleGroup.Item value="this" className={styles.option}>
          <b>Just this meal</b>
          <span>{slotName(slot)} changes. The other meals keep {cookTitle}.</span>
        </ToggleGroup.Item>
        <ToggleGroup.Item value="with_leftovers" className={styles.option}>
          <b>This and its leftovers</b>
          <span>{fed.map(slotName).join(", ")} all switch.</span>
        </ToggleGroup.Item>
      </ToggleGroup.Root>
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
}

function PickerRow({ recipe, mealType, availability }: PickerRowProps) {
  const [ref, seen] = useSeen<HTMLButtonElement>();
  return (
    <ToggleGroup.Item ref={ref} value={recipe.id} className={styles.row}>
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
    </ToggleGroup.Item>
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
