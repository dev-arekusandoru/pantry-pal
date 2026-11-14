import { useEffect, useMemo, useState } from "react";
import { Button, Emoji, SearchInput, Sheet } from "@/ui";
import { monthDay, weekdayName } from "../../../dates";
import { MEAL_EMOJI, MEAL_LABEL, type MealType, type RecipeSummary } from "../../../model";
import { RecipePhoto } from "@/screens/recipe/RecipePhoto";
import { addBatch, addNote, type Draft } from "../../draft";
import styles from "./mobile.module.css";

interface RecipeSheetProps {
  open: boolean;
  onClose: () => void;
  date: string;
  /** The meal the sheet was opened from; preselected, others reachable from the tabs. */
  meal: MealType;
  setDraft: (fn: (d: Draft) => Draft) => void;
  recipes: Map<string, RecipeSummary> | undefined;
}

const MEAL_TABS: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack", "dessert"];

const FREEFORM = [
  { label: "Eat out", icon: "french-fries" },
  { label: "Fridge clean-out", icon: "milk" },
] as const;

/** Pick something for one meal: a recipe for that section, a freeform card, or a name you type. */
export function RecipeSheet({ open, onClose, date, meal, setDraft, recipes }: RecipeSheetProps) {
  const [query, setQuery] = useState("");
  const [writing, setWriting] = useState(false);
  const [name, setName] = useState("");
  const [active, setActive] = useState<MealType>(meal);

  // Reopening from another section starts on that section again.
  useEffect(() => {
    if (open) setActive(meal);
  }, [open, meal]);

  const list = useMemo(() => {
    if (!recipes) return undefined;
    const q = query.trim().toLowerCase();
    return [...recipes.values()]
      .filter((r) => r.status !== "archived" && r.mealTypes.includes(active))
      .filter((r) => !q || `${r.title} ${r.cuisine ?? ""} ${r.tags.join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [recipes, active, query]);

  const close = () => {
    setQuery("");
    setWriting(false);
    setName("");
    onClose();
  };

  const placeRecipe = (recipe: RecipeSummary) => {
    setDraft((d) => addBatch(d, recipe, date, active));
    close();
  };

  const placeNote = (label: string) => {
    setDraft((d) => addNote(d, "freeform", label, date, active));
    close();
  };

  return (
    <Sheet open={open} onClose={close} title={`Add to ${MEAL_LABEL[active]}, ${weekdayName(date, "short")} ${monthDay(date)}`}>
      <div className={styles.sheetBody}>
        <div className={styles.sheetTop}>
          <SearchInput value={query} onChange={setQuery} label="Search recipes" />
          <div className={styles.mealTabs} role="group" aria-label="Which meal">
            {MEAL_TABS.map((m) => (
              <button key={m} type="button" className={styles.mealTab} aria-pressed={m === active} onClick={() => setActive(m)}>
                <Emoji code={MEAL_EMOJI[m]} size={16} />
                {MEAL_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        {list === undefined && <p className={styles.emptyLine}>Loading recipes…</p>}
        {list?.length === 0 && (
          <p className={styles.emptyLine}>
            No {MEAL_LABEL[active].toLowerCase()} recipes{query ? ` for “${query}”` : ""}.
          </p>
        )}
        {list && list.length > 0 && (
          <ul className={styles.recipeGrid}>
            {list.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={styles.recipeCard}
                  aria-label={`Add ${r.title} to ${MEAL_LABEL[active]}`}
                  onClick={() => placeRecipe(r)}
                >
                  <RecipePhoto imageUrl={r.imageUrl} mealTypes={r.mealTypes} className={styles.recipePhoto} />
                  <span className={styles.recipeTitle}>{r.title}</span>
                  <span className={styles.recipeMeta}>
                    {[r.totalMinutes ? `${r.totalMinutes} min` : null, `serves ${r.servings}`].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.freeformBlock}>
          <h3 className={styles.freeformHead}>Or nothing to cook</h3>
          <ul className={styles.freeform}>
            {FREEFORM.map((f) => (
              <li key={f.label}>
                <button type="button" className={styles.freeformCard} onClick={() => placeNote(f.label)}>
                  <Emoji code={f.icon} size={22} />
                  <span>{f.label}</span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className={styles.freeformCard}
                aria-expanded={writing}
                onClick={() => {
                  setWriting((w) => !w);
                  setName("");
                }}
              >
                <Emoji code="clay-pot" size={22} />
                <span>Write your own</span>
              </button>
            </li>
          </ul>

          {writing && (
            <form
              className={styles.writeForm}
              onSubmit={(e) => {
                e.preventDefault();
                const label = name.trim();
                if (label) placeNote(label);
              }}
            >
              <label className={styles.fieldLabel} htmlFor="mobile-note-name">
                What is it?
              </label>
              <input
                id="mobile-note-name"
                className={styles.nameInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                enterKeyHint="done"
                maxLength={80}
                placeholder="Leftover soup, takeaway…"
              />
              <Button type="submit" variant="primary" disabled={!name.trim()}>
                Add {MEAL_LABEL[active].toLowerCase()}
              </Button>
            </form>
          )}
        </div>
      </div>
    </Sheet>
  );
}
