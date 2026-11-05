import { Link } from "@tanstack/react-router";
import { VisuallyHidden } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, ErrorState, Icon, PageHeader, Pill, SearchInput, SegmentedControl, Skeleton, type SegmentOption } from "@/ui";
import { formatMinutes, type MealType } from "../recipe/lib";
import { useSetRecipeStatus } from "../recipe/queries";
import { RecipePhoto } from "../recipe/RecipePhoto";
import { isNewToTry, type StatusView } from "./filter";
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

const STATUS_OPTIONS: ReadonlyArray<SegmentOption<StatusView>> = [
  { value: "box", label: "Rotation + want to try" },
  { value: "never", label: "Never" },
];

export interface RecipesScreenProps {
  view: StatusView;
  meal: MealFilter;
  query: string;
  onChange: (next: { view: StatusView; meal: MealFilter; query: string }) => void;
}

const SEARCH_DEBOUNCE_MS = 250;

export function RecipesScreen({ view, meal, query, onChange }: RecipesScreenProps) {
  // The input is local so typing never waits on the router; the URL follows after a pause.
  const [text, setText] = useState(query);
  const latest = useRef({ view, meal, onChange });
  latest.current = { view, meal, onChange };

  useEffect(() => {
    if (text === query) return;
    const t = setTimeout(
      () => latest.current.onChange({ view: latest.current.view, meal: latest.current.meal, query: text }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [text, query]);

  const recipes = useRecipeBox(view, meal, query);
  const setStatus = useSetRecipeStatus();
  const items = recipes.data;
  const filtered = meal !== "all" || query.trim() !== "";

  return (
    <div>
      <PageHeader
        title="Recipes"
        sub={
          items ? (
            <span aria-live="polite">
              {`${items.length} ${items.length === 1 ? "recipe" : "recipes"} ${
                view === "never" ? "set aside" : filtered ? "found" : "in the box"
              }`}
            </span>
          ) : undefined
        }
      />
      <SearchInput label="Search recipes" value={text} onChange={setText} />
      <SegmentedControl
        label="Filter by status"
        options={STATUS_OPTIONS}
        value={view}
        onChange={(v) => onChange({ view: v, meal, query: text })}
      />
      <SegmentedControl
        label="Filter by meal"
        options={OPTIONS}
        value={meal}
        onChange={(m) => onChange({ view, meal: m, query: text })}
      />

      {recipes.isPending ? (
        <div className={styles.grid} role="status">
          <VisuallyHidden.Root>Loading recipes</VisuallyHidden.Root>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={230} radius={30} />
          ))}
        </div>
      ) : recipes.isError && !items ? (
        <ErrorState error={recipes.error} onRetry={() => void recipes.refetch()} />
      ) : items && items.length === 0 ? (
        <EmptyState
          emoji={view === "never" ? "1F645" : "1F50D"}
          title={view === "never" ? "Nothing set aside" : filtered ? "No recipes match" : "No recipes yet"}
        >
          {view === "never"
            ? "Recipes you never want to cook again show up here. Move one back to rotation when you change your mind."
            : filtered
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
                    {isNewToTry(r.status) && (
                      <Pill tone="pistachio" className={styles.tag}>
                        New to try
                      </Pill>
                    )}
                    <p className={styles.meta}>
                      {time && (
                        <span>
                          <Icon name="clock" /> {time}
                        </span>
                      )}
                      <span>
                        <Icon name="people" /> <VisuallyHidden.Root>Serves </VisuallyHidden.Root>{r.servings}
                      </span>
                    </p>
                  </div>
                </Link>
                {view === "never" && (
                  <Button
                    variant="ghost"
                    className={styles.cardAction}
                    loading={setStatus.isPending && setStatus.variables?.slug === r.slug}
                    onClick={() => setStatus.mutate({ slug: r.slug, status: "rotation" })}
                  >
                    Move to rotation
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
