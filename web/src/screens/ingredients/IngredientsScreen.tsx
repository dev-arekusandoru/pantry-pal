import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button, Card, EmptyState, ErrorState, Icon, PageHeader, Pill, SearchInput, SegmentedControl, Sheet, Skeleton, Sticker, ingredientEmoji, type SegmentOption } from "@/ui";
import { aisleLabel } from "../aisles";
import { IngredientPicker } from "./IngredientPicker";
import styles from "./Ingredients.module.css";
import { buildRows, countFilters, filterRows, groupByAisle, type LibraryFilter, type LibraryRow } from "./library";
import { useIngredientLibrary, useReviewList, useUsageCounts } from "./queries";
import { usePageEntry } from "./usePageEntry";

const FILTER_LABELS: Record<LibraryFilter, string> = {
  all: "All",
  attention: "Needs attention",
  custom: "Custom",
  unused: "Unused",
};

const EMPTY_FILTER: Record<Exclude<LibraryFilter, "all">, { title: string; text: string }> = {
  attention: { title: "Nothing needs attention", text: "Every ingredient has a USDA food or a custom entry you accepted." },
  custom: { title: "No custom ingredients", text: "Every ingredient is linked to a USDA food." },
  unused: { title: "Every ingredient is in use", text: "Each one is in a recipe, the pantry, a shopping list or a dietary rule." },
};

export interface IngredientsScreenProps {
  filter: LibraryFilter;
  onFilter: (filter: LibraryFilter) => void;
}

/** All ingredients in one searchable list, grouped by aisle. Each row opens the ingredient page. */
export function IngredientsScreen({ filter, onFilter }: IngredientsScreenProps) {
  const list = useIngredientLibrary();
  const review = useReviewList();
  const usage = useUsageCounts();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const rows = useMemo(
    () =>
      list.data === undefined || review.data === undefined || usage.data === undefined
        ? undefined
        : buildRows(
            list.data,
            new Set(review.data.map((item) => item.ingredient.id)),
            new Set(usage.data.map((item) => item.ingredientId)),
          ),
    [list.data, review.data, usage.data],
  );
  // The header is part of the loaded screen: focus it once the list is there.
  usePageEntry(rows === undefined ? undefined : "Ingredients");

  const failed = list.error ?? review.error ?? usage.error;
  if (failed && rows === undefined) {
    return (
      <>
        <PageHeader title="Ingredients" />
        <ErrorState
          error={failed}
          onRetry={() => {
            void list.refetch();
            void review.refetch();
            void usage.refetch();
          }}
        />
      </>
    );
  }

  if (rows === undefined) {
    return (
      <div aria-busy="true" aria-label="Loading ingredients">
        <PageHeader title="Ingredients" />
        <div className={styles.skeletons}>
          <Skeleton height={44} radius={999} />
          <Skeleton height={40} radius={999} width="70%" />
          <Skeleton height={260} radius={30} />
        </div>
      </div>
    );
  }

  const counts = countFilters(rows);
  const shown = filterRows(rows, filter, query);
  const groups = groupByAisle(shown);
  const options: Array<SegmentOption<LibraryFilter>> = (["all", "attention", "custom", "unused"] as const).map((value) => ({
    value,
    label: `${FILTER_LABELS[value]} (${counts[value]})`,
  }));
  const addButton = (
    <Button variant="primary" icon={<Icon name="plus" />} onClick={() => setAdding(true)}>
      Add
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Ingredients"
        sub={
          rows.length === 0
            ? "No ingredients yet"
            : counts.attention === 0
              ? `${rows.length} ${rows.length === 1 ? "ingredient" : "ingredients"}`
              : `${rows.length} ${rows.length === 1 ? "ingredient" : "ingredients"}, ${counts.attention} to check`
        }
        aside={rows.length > 0 ? addButton : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState emoji="relish" title="No ingredients yet" action={addButton}>
          Add an ingredient, or add one to a recipe or the pantry. Each ingredient gets its own page.
        </EmptyState>
      ) : (
        <>
          <div className={styles.tools}>
            <SearchInput label="Search ingredients" value={query} onChange={setQuery} />
            <SegmentedControl<LibraryFilter> label="Show" value={filter} onChange={onFilter} options={options} />
          </div>
          <p className={styles.status} role="status">
            {shown.length === 0 ? "No ingredients shown" : `${shown.length} ${shown.length === 1 ? "ingredient" : "ingredients"} shown`}
          </p>
          {groups.length === 0 ? (
            query.trim() !== "" || filter === "all" ? (
              <EmptyState emoji="empty-bowl" title={`Nothing matches "${query.trim()}"`}>
                Try another name, or pick All.
              </EmptyState>
            ) : (
              <EmptyState emoji="relish" title={EMPTY_FILTER[filter].title}>
                {EMPTY_FILTER[filter].text}
              </EmptyState>
            )
          ) : (
            groups.map((group) => (
              <Card key={group.category} as="section" radius="xl" className={styles.shelf} aria-labelledby={`aisle-${group.category}`}>
                <h2 id={`aisle-${group.category}`} className={styles.shelfName}>
                  {aisleLabel(group.category)}
                  <small>{group.rows.length}</small>
                </h2>
                <ul className={styles.rows}>
                  {group.rows.map((row) => (
                    <IngredientRow key={row.ingredient.id} row={row} />
                  ))}
                </ul>
              </Card>
            ))
          )}
        </>
      )}
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add an ingredient">
        <p className={styles.sheetText}>Search first. Pick a USDA food when one fits, and create a custom ingredient only when none does.</p>
        <IngredientPicker
          label="Ingredient"
          value={null}
          autoFocus
          onChange={(pick) => {
            setAdding(false);
            void navigate({ to: "/ingredients/$id", params: { id: pick.id } });
          }}
        />
      </Sheet>
    </>
  );
}

function IngredientRow({ row }: { row: LibraryRow }) {
  const { ingredient, linked, attention, unused } = row;
  return (
    <li>
      <Link to="/ingredients/$id" params={{ id: ingredient.id }} className={styles.row}>
        <Sticker emoji={ingredientEmoji(ingredient.name, ingredient.imageUrl)} fallback={ingredientEmoji(ingredient.name)} tone="plain" size={40} />
        <span className={styles.body}>
          <span className={styles.name}>{ingredient.name}</span>
          <span className={styles.food}>{linked ? (ingredient.nutrition?.description ?? "USDA food") : "No USDA food"}</span>
        </span>
        <span className={styles.badges}>
          {attention && <Pill tone="gum">Needs attention</Pill>}
          <Pill tone={linked ? "pistachio" : "peach"}>{linked ? "Linked" : "Custom"}</Pill>
          {unused && <Pill>Unused</Pill>}
        </span>
      </Link>
    </li>
  );
}
