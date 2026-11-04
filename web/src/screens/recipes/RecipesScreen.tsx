import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { EmptyState, ErrorState, Icon, PageHeader, SearchInput, SegmentedControl, Skeleton, type SegmentOption } from "@/ui";
import { formatMinutes, type MealType } from "../recipe/lib";
import { RecipePhoto } from "../recipe/RecipePhoto";
import { useRecipeBox, type MealFilter } from "./queries";
import styles from "./RecipesScreen.module.css";

const OPTIONS: ReadonlyArray<SegmentOption<MealFilter>> = [
  { value: "all", label: "All" },
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snacks" },
  { value: "dessert", label: "Dessert" },
];

export interface RecipesScreenProps {
  meal: MealFilter;
  query: string;
  onChange: (next: { meal: MealFilter; query: string }) => void;
}

const SEARCH_DEBOUNCE_MS = 250;

export function RecipesScreen({ meal, query, onChange }: RecipesScreenProps) {
  // The input is local so typing never waits on the router; the URL follows after a pause.
  const [text, setText] = useState(query);
  const latest = useRef({ meal, onChange });
  latest.current = { meal, onChange };

  useEffect(() => {
    if (text === query) return;
    const t = setTimeout(() => latest.current.onChange({ meal: latest.current.meal, query: text }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, query]);

  const recipes = useRecipeBox(meal, query);
  const items = recipes.data;
  const filtered = meal !== "all" || query.trim() !== "";

  return (
    <div>
      <PageHeader
        title="Recipes"
        sub={items ? `${items.length} ${items.length === 1 ? "recipe" : "recipes"}${filtered ? " found" : " in the box"}` : undefined}
      />
      <SearchInput label="Search recipes" value={text} onChange={setText} />
      <SegmentedControl
        label="Filter by meal"
        options={OPTIONS}
        value={meal}
        onChange={(m) => onChange({ meal: m, query: text })}
      />

      {recipes.isPending ? (
        <div className={styles.grid} aria-busy="true" aria-label="Loading recipes">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={230} radius={30} />
          ))}
        </div>
      ) : recipes.isError && !items ? (
        <ErrorState error={recipes.error} onRetry={() => void recipes.refetch()} />
      ) : items && items.length === 0 ? (
        <EmptyState emoji="🔍" title={filtered ? "No recipes match" : "No recipes yet"}>
          {filtered
            ? "Try another meal or a different word."
            : "Ask your agent to add some recipes and they will show up here."}
        </EmptyState>
      ) : (
        <ul className={styles.grid}>
          {items?.map((r, i) => {
            const time = formatMinutes(r.totalMinutes ?? (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0));
            return (
              <li key={r.id} className={styles.card} style={{ "--i": i } as React.CSSProperties}>
                <Link to="/recipes/$slug" params={{ slug: r.slug }} className={styles.link}>
                  <RecipePhoto imageUrl={r.imageUrl} mealTypes={r.mealTypes as MealType[]} className={styles.photo} />
                  <div className={styles.body}>
                    <h3>{r.title}</h3>
                    <p className={styles.meta}>
                      {time && (
                        <span>
                          <Icon name="clock" /> {time}
                        </span>
                      )}
                      <span>
                        <Icon name="people" /> {r.servings}
                      </span>
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
