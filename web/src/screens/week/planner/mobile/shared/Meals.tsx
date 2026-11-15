import { useState } from "react";
import { Emoji, Icon, toast } from "@/ui";
import { weekdayName } from "../../../dates";
import { CORE_MEALS, MEAL_EMOJI, MEAL_LABEL, type MealType, type RecipeSummary } from "../../../model";
import { removeEat, type Draft, type DraftBatch, type DraftEat } from "../../draft";
import { restoreEat } from "../../model";
import styles from "./mobile.module.css";
import { BatchSheet } from "./BatchSheet";
import { CookCard, DishCard, NoteCard } from "./Chip";
import { RecipeSheet } from "./RecipeSheet";

const MEAL_ORDER: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack", "dessert"];
const EXTRA_MEALS = MEAL_ORDER.filter((m) => !CORE_MEALS.includes(m));

interface DayBodyProps {
  draft: Draft;
  setDraft: (fn: (d: Draft) => Draft) => void;
  recipes: Map<string, RecipeSummary> | undefined;
  date: string;
}

/** One day: the cooking strip, then a section per meal. Placing happens in the sheets. */
export function DayBody({ draft, setDraft, recipes, date }: DayBodyProps) {
  const [picking, setPicking] = useState<MealType | null>(null);
  const [editing, setEditing] = useState<{ batchId: string; eatId: string | null } | null>(null);

  const cooks = draft.batches.filter((b) => b.cookDate === date);

  const used = new Set<MealType>([
    ...draft.batches.flatMap((b) => b.eats.filter((e) => e.date === date).map((e) => e.mealType)),
    ...draft.notes.filter((n) => n.date === date).map((n) => n.mealType),
  ]);

  const removeMeal = (batch: DraftBatch, eat: DraftEat) => {
    setDraft((d) => removeEat(d, batch.id, eat.id));
    toast.show({
      message: `Removed ${batch.title} from ${weekdayName(eat.date)} ${MEAL_LABEL[eat.mealType]}`,
      action: { label: "Undo", onClick: () => setDraft((d) => restoreEat(d, batch, eat)) },
    });
  };

  const removeNote = (id: string) => {
    const note = draft.notes.find((n) => n.id === id);
    if (!note) return;
    setDraft((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) }));
    toast.show({
      message: `Removed ${note.label} from ${weekdayName(note.date)} ${MEAL_LABEL[note.mealType]}`,
      action: {
        label: "Undo",
        onClick: () => setDraft((d) => (d.notes.some((n) => n.id === note.id) ? d : { ...d, notes: [...d.notes, note] })),
      },
    });
  };

  const when = weekdayName(date);

  // Empty meals keep their header and the dashed slot, so the day reads the same at a glance.
  const mealSection = (meal: MealType) => {
    const eats = draft.batches.flatMap((batch) =>
      batch.eats.filter((e) => e.date === date && e.mealType === meal).map((eat) => ({ batch, eat })),
    );
    const notes = draft.notes.filter((n) => n.date === date && n.mealType === meal);
    const label = MEAL_LABEL[meal];
    const empty = eats.length + notes.length === 0;
    return (
      <section key={meal} className={styles.mealRow} aria-label={`${label} on ${when}`}>
        <div className={styles.mealHead}>
          <h3 className={styles.mealLabel}>
            <Emoji code={MEAL_EMOJI[meal]} size={20} />
            {label}
          </h3>
          <button
            type="button"
            className={styles.addDish}
            aria-label={`Add ${label.toLowerCase()} on ${when}`}
            onClick={() => setPicking(meal)}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
        {empty ? (
          <button type="button" className={styles.emptySlot} aria-label={`Plan ${label.toLowerCase()} on ${when}`} onClick={() => setPicking(meal)}>
            <Icon name="plus" size={15} />
            Plan {label.toLowerCase()}
          </button>
        ) : (
          <ul className={styles.dishList}>
            {eats.map(({ batch, eat }) => (
              <li key={eat.id}>
                <DishCard
                  batch={batch}
                  eat={eat}
                  recipe={recipes?.get(batch.recipeId)}
                  onOpen={() => setEditing({ batchId: batch.id, eatId: eat.id })}
                  onRemove={() => removeMeal(batch, eat)}
                />
              </li>
            ))}
            {notes.map((n) => (
              <li key={n.id}>
                <NoteCard note={n} onRemove={() => removeNote(n.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  const unusedExtras = EXTRA_MEALS.filter((m) => !used.has(m));

  return (
    <div className={styles.dayBody}>
      {cooks.length > 0 && (
        <section className={styles.cookStrip} aria-label={`Cooking ${when}`}>
          <h3 className={styles.cookStripTitle}>
            <Icon name="flame" size={14} />
            Cooking today
          </h3>
          <ul className={styles.cookRow} data-no-swipe="">
            {cooks.map((b) => (
              <li key={b.id}>
                <CookCard batch={b} recipe={recipes?.get(b.recipeId)} onOpen={() => setEditing({ batchId: b.id, eatId: null })} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {CORE_MEALS.map(mealSection)}

      {unusedExtras.length > 0 && (
        <div className={styles.extraPick}>
          {unusedExtras.map((m) => (
            <button
              key={m}
              type="button"
              className={styles.extraChip}
              aria-label={`Add ${MEAL_LABEL[m].toLowerCase()} on ${when}`}
              onClick={() => setPicking(m)}
            >
              <Icon name="plus" size={14} />
              {MEAL_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      {EXTRA_MEALS.filter((m) => used.has(m)).map(mealSection)}

      <RecipeSheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        date={date}
        meal={picking ?? "dinner"}
        setDraft={setDraft}
        recipes={recipes}
      />

      <BatchSheet
        open={editing !== null}
        batchId={editing?.batchId ?? null}
        eatId={editing?.eatId ?? null}
        draft={draft}
        setDraft={setDraft}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
