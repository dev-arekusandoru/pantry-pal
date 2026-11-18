import { VisuallyHidden } from "radix-ui";
import { useEffect, useState } from "react";
import { Button, Pill, SearchInput, Sheet, Skeleton, toast } from "@/ui";
import { formatWhole, type NutritionLine } from "./nutrition";
import { useFoodSearch, useSetIngredientNutrition, type IngredientNutritionChoice } from "./queries";
import styles from "./NutritionMatchSheet.module.css";

export interface NutritionMatchSheetProps {
  /** The ingredient line being matched; null closes the sheet. */
  line: NutritionLine | null;
  onClose: () => void;
}

/** Pick the USDA food that supplies an ingredient's nutrition, clear it, or go back to the automatic match. */
export function NutritionMatchSheet({ line, onClose }: NutritionMatchSheetProps) {
  const set = useSetIngredientNutrition();

  function choose(target: NutritionLine, choice: IngredientNutritionChoice, message: string) {
    set.mutate(
      { ingredientId: target.ingredientId, choice },
      {
        onSuccess: () => {
          onClose();
          toast.show({ message });
        },
      },
    );
  }

  return (
    <Sheet
      open={line !== null}
      onClose={onClose}
      title="Match a USDA food"
      footer={
        <>
          <Button
            disabled={line === null || set.isPending}
            onClick={() => line && choose(line, { mode: "manual", fdcId: null }, `${line.name} has no food match`)}
          >
            No match
          </Button>
          <Button
            disabled={line === null || set.isPending}
            onClick={() => line && choose(line, { mode: "auto" }, `${line.name} uses the automatic match`)}
          >
            Auto match
          </Button>
        </>
      }
    >
      {line && (
        <Body
          key={line.recipeIngredientId}
          line={line}
          pending={set.isPending}
          onPick={(food) => choose(line, { mode: "manual", fdcId: food.fdcId }, `${line.name} now uses ${food.description}`)}
        />
      )}
    </Sheet>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function Body({ line, pending, onPick }: { line: NutritionLine; pending: boolean; onPick: (food: { fdcId: number; description: string }) => void }) {
  const [search, setSearch] = useState(line.name);
  const foods = useFoodSearch(useDebounced(search, 250));

  const results = foods.data;
  const typed = search.trim() !== "";
  const resultCount = !typed
    ? ""
    : foods.isError
      ? "Couldn't search foods"
      : results === undefined
        ? "Searching foods"
        : `${results.length} ${results.length === 1 ? "food" : "foods"} found`;

  return (
    <>
      <p className={styles.current}>
        <b>{line.name}</b> now uses: {line.food ? line.food.description : "no match"}
      </p>
      <p className={styles.scope}>
        The food you pick applies to {line.name} in every recipe. “No match” leaves it out of the totals.
      </p>
      <SearchInput label="Search USDA foods" value={search} onChange={setSearch} className={styles.search} />
      <VisuallyHidden.Root role="status">{resultCount}</VisuallyHidden.Root>

      {!typed ? (
        <p className={styles.note}>Type a food name to search.</p>
      ) : foods.isError ? (
        <p className={styles.note} role="alert">
          Couldn't search foods. Try again in a moment.
        </p>
      ) : results === undefined ? (
        <div className={styles.list} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={58} radius={14} />
          ))}
        </div>
      ) : results.length === 0 ? (
        <p className={styles.note}>No foods match “{search.trim()}”. Try a shorter name, such as “tomato”.</p>
      ) : (
        <ul className={styles.list} aria-label="USDA foods">
          {results.map((food) => {
            const current = food.fdcId === line.food?.fdcId;
            return (
              <li key={food.fdcId}>
                <button
                  type="button"
                  className={styles.food}
                  aria-current={current || undefined}
                  disabled={pending}
                  onClick={() => onPick(food)}
                >
                  <span className={styles.foodName}>{food.description}</span>
                  <span className={styles.foodMeta}>
                    {food.per100g?.calories == null ? "Calories unknown" : `${formatWhole(food.per100g.calories)} kcal per 100 g`}
                    {current && <Pill tone="pistachio">In use</Pill>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
