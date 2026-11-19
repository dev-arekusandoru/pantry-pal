import { VisuallyHidden } from "radix-ui";
import { useState } from "react";
import type { components } from "@/api";
import { Pill, SearchInput, Skeleton } from "@/ui";
import { formatWhole } from "../recipe/nutrition";
import { useFoodSearch } from "../recipe/queries";
import styles from "./FoodSearch.module.css";
import { useDebounced } from "./queries";

export interface FoodSearchProps {
  initialQuery: string;
  /** The food already in use, marked "In use". */
  currentFdcId?: number | null;
  pending?: boolean;
  onPick: (food: components["schemas"]["Food"]) => void;
}

/** Search USDA foods and pick one. Shared by the nutrition match sheet and the ingredient review. */
export function FoodSearch({ initialQuery, currentFdcId = null, pending = false, onPick }: FoodSearchProps) {
  const [search, setSearch] = useState(initialQuery);
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
            const current = food.fdcId === currentFdcId;
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
