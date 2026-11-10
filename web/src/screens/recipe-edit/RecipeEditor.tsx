import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { errorMessage } from "@/api";
import { Button, ErrorState, Icon, PageHeader, Skeleton, buttonClass, toast } from "@/ui";
import type { RecipeDetail } from "../recipe/lib";
import { useRecipe } from "../recipe/queries";
import { useCreateRecipe, useTagSuggestions, useUpdateRecipe, type RecipeSaveInput } from "./queries";
import styles from "./recipe-edit.module.css";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "dessert"] as const;
type MealType = (typeof MEAL_TYPES)[number];

interface LineDraft {
  key: string;
  name: string;
  qty: string;
  qtyMax: string;
  unit: string;
  prepNote: string;
  groupLabel: string;
  optional: boolean;
  scalingExempt: boolean;
}

interface LinkDraft {
  key: string;
  lineKey: string;
  qty: string;
}

interface StepDraft {
  key: string;
  text: string;
  durationMinutes: string;
  groupLabel: string;
  links: LinkDraft[];
}

let nextKey = 0;
const newKey = () => `draft-${++nextKey}`;

const text = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));
const num = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};
const whole = (value: string): number | null => {
  const parsed = num(value);
  return parsed === null ? null : Math.trunc(parsed);
};

function emptyLine(): LineDraft {
  return {
    key: newKey(),
    name: "",
    qty: "",
    qtyMax: "",
    unit: "",
    prepNote: "",
    groupLabel: "",
    optional: false,
    scalingExempt: false,
  };
}

function emptyStep(): StepDraft {
  return { key: newKey(), text: "", durationMinutes: "", groupLabel: "", links: [] };
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

interface DraftState {
  title: string;
  servings: string;
  prepMinutes: string;
  cookMinutes: string;
  totalMinutes: string;
  mealTypes: MealType[];
  tags: string[];
  equipment: string;
  notes: string;
  sourceName: string;
  sourceUrl: string;
  lines: LineDraft[];
  steps: StepDraft[];
}

function initialState(recipe: RecipeDetail | undefined): DraftState {
  if (recipe === undefined) {
    return {
      title: "",
      servings: "2",
      prepMinutes: "",
      cookMinutes: "",
      totalMinutes: "",
      mealTypes: [],
      tags: [],
      equipment: "",
      notes: "",
      sourceName: "",
      sourceUrl: "",
      lines: [emptyLine()],
      steps: [emptyStep()],
    };
  }

  const lineKeyById = new Map<string, string>();
  const lines = recipe.ingredients.map<LineDraft>((ri) => {
    const key = newKey();
    lineKeyById.set(ri.id, key);
    return {
      key,
      name: ri.ingredient.name,
      qty: text(ri.qty),
      qtyMax: text(ri.qtyMax),
      unit: ri.unit ?? "",
      prepNote: ri.prepNote ?? "",
      groupLabel: ri.groupLabel ?? "",
      optional: ri.optional,
      scalingExempt: ri.scalingExempt,
    };
  });

  return {
    title: recipe.title,
    servings: text(recipe.servings),
    prepMinutes: text(recipe.prepMinutes),
    cookMinutes: text(recipe.cookMinutes),
    totalMinutes: text(recipe.totalMinutes),
    mealTypes: recipe.mealTypes.filter((m): m is MealType => (MEAL_TYPES as readonly string[]).includes(m)),
    tags: [...recipe.tags],
    equipment: recipe.equipment.join(", "),
    notes: recipe.notes ?? "",
    sourceName: recipe.sourceName ?? "",
    sourceUrl: recipe.sourceUrl ?? "",
    lines: lines.length > 0 ? lines : [emptyLine()],
    steps:
      recipe.steps.length > 0
        ? recipe.steps.map((step) => ({
            key: newKey(),
            text: step.text,
            durationMinutes: text(step.durationMinutes),
            groupLabel: step.groupLabel ?? "",
            links: step.links.flatMap<LinkDraft>((link) => {
              const lineKey = lineKeyById.get(link.recipeIngredientId);
              return lineKey === undefined
                ? []
                : [{ key: newKey(), lineKey, qty: text(link.qty) }];
            }),
          }))
        : [emptyStep()],
  };
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Non-blocking check: each line's step amounts should add up to its total. */
function reconciliationWarnings(lines: LineDraft[], steps: StepDraft[]): string[] {
  const warnings: string[] = [];
  for (const line of lines) {
    const total = num(line.qty);
    if (total === null) continue;
    let sum = 0;
    let links = 0;
    for (const step of steps) {
      for (const link of step.links) {
        if (link.lineKey !== line.key) continue;
        links += 1;
        const qty = num(link.qty);
        sum += qty === null ? total : qty;
      }
    }
    if (links === 0) continue;
    if (Math.abs(sum - total) > 1e-6) {
      warnings.push(
        `${line.name.trim() === "" ? "One ingredient line" : line.name.trim()}: step amounts add up to ${round(sum)}${line.unit === "" ? "" : ` ${line.unit}`}, but the line is ${round(total)}${line.unit === "" ? "" : ` ${line.unit}`}.`,
      );
    }
  }
  return warnings;
}

export interface RecipeEditorProps {
  /** Slug to edit; omit to create. */
  slug?: string;
}

export function RecipeEditorScreen({ slug }: RecipeEditorProps) {
  const recipe = useRecipe(slug);
  if (slug === undefined) return <EditorForm />;
  if (recipe.isPending) return <EditorSkeleton />;
  if (recipe.isError) return <ErrorState error={recipe.error} onRetry={() => void recipe.refetch()} />;
  return <EditorForm recipe={recipe.data} />;
}

function EditorSkeleton() {
  return (
    <div className={styles.page} role="status">
      <Skeleton height={72} radius={28} />
      <Skeleton height={220} radius={28} />
      <Skeleton height={220} radius={28} />
    </div>
  );
}

function EditorForm({ recipe }: { recipe?: RecipeDetail }) {
  const navigate = useNavigate();
  const create = useCreateRecipe();
  const update = useUpdateRecipe(recipe?.slug ?? "");
  const save = recipe === undefined ? create : update;
  const tagSuggestions = useTagSuggestions();

  const [draft, setDraft] = useState<DraftState>(() => initialState(recipe));
  const [tagText, setTagText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const patch = (values: Partial<DraftState>) => setDraft((current) => ({ ...current, ...values }));
  const patchLine = (key: string, values: Partial<LineDraft>) =>
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...values } : line)),
    }));
  const patchStep = (key: string, values: Partial<StepDraft>) =>
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.key === key ? { ...step, ...values } : step)),
    }));

  const warnings = useMemo(() => reconciliationWarnings(draft.lines, draft.steps), [draft.lines, draft.steps]);
  const lineName = (key: string) => draft.lines.find((line) => line.key === key)?.name.trim() ?? "";

  function addTag() {
    const value = tagText.trim();
    if (value === "") return;
    setDraft((current) =>
      current.tags.some((tag) => tag.toLowerCase() === value.toLowerCase())
        ? current
        : { ...current, tags: [...current.tags, value] },
    );
    setTagText("");
  }

  function addLink(step: StepDraft, lineKey: string) {
    if (lineKey === "") return;
    if (step.links.some((link) => link.lineKey === lineKey)) return;
    patchStep(step.key, { links: [...step.links, { key: newKey(), lineKey, qty: "" }] });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.title.trim() === "") {
      setFormError("Add a title.");
      return;
    }
    const keptLines = draft.lines.filter((line) => line.name.trim() !== "");
    const lineIndex = new Map<string, number>();
    keptLines.forEach((line, index) => lineIndex.set(line.key, index));
    if (keptLines.length === 0) {
      setFormError("Add at least one ingredient line.");
      return;
    }
    const servings = num(draft.servings);
    if (servings !== null && servings <= 0) {
      setFormError("Servings must be more than zero.");
      return;
    }

    const input: RecipeSaveInput = {
      title: draft.title.trim(),
      ...(servings === null ? {} : { servings }),
      prepMinutes: whole(draft.prepMinutes),
      cookMinutes: whole(draft.cookMinutes),
      // Create derives total from prep + cook when it is omitted; an edit clears it.
      totalMinutes: whole(draft.totalMinutes) ?? (recipe === undefined ? undefined : null),
      mealTypes: draft.mealTypes,
      tags: draft.tags,
      equipment: draft.equipment
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== ""),
      notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      sourceName: draft.sourceName.trim() === "" ? null : draft.sourceName.trim(),
      sourceUrl: draft.sourceUrl.trim() === "" ? null : draft.sourceUrl.trim(),
      ingredients: keptLines.map((line) => ({
        ingredient: line.name.trim(),
        qty: num(line.qty),
        qtyMax: num(line.qtyMax),
        unit: line.unit.trim() === "" ? null : line.unit.trim(),
        prepNote: line.prepNote.trim() === "" ? null : line.prepNote.trim(),
        optional: line.optional,
        scalingExempt: line.scalingExempt,
        groupLabel: line.groupLabel.trim() === "" ? null : line.groupLabel.trim(),
      })),
      steps: draft.steps
        .filter((step) => step.text.trim() !== "")
        .map((step) => ({
          text: step.text.trim(),
          durationMinutes: whole(step.durationMinutes),
          groupLabel: step.groupLabel.trim() === "" ? null : step.groupLabel.trim(),
          links: step.links.flatMap((link) => {
            const index = lineIndex.get(link.lineKey);
            if (index === undefined) return [];
            return [{ ingredientIndex: index, qty: num(link.qty) }];
          }),
        })),
    };

    setFormError(null);
    save.mutate(input, {
      onSuccess: (saved) => {
        toast.show({ message: recipe === undefined ? "Recipe created" : "Recipe saved" });
        void navigate({ to: "/recipes/$slug", params: { slug: saved.slug } });
      },
      onError: (error) => setFormError(errorMessage(error)),
    });
  }

  return (
    <form className={styles.page} onSubmit={submit} noValidate>
      <PageHeader
        title={recipe === undefined ? "New recipe" : "Edit recipe"}
        sub={recipe === undefined ? "Add a recipe to the box." : recipe.title}
      />

      <section className={styles.card}>
        <h2 className={styles.heading}>Basics</h2>
        <label className={styles.field}>
          <span className={styles.label}>Title</span>
          <input
            className={styles.input}
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
            autoComplete="off"
            required
          />
        </label>
        <div className={styles.triple}>
          <label className={styles.field}>
            <span className={styles.label}>Servings</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={draft.servings}
              onChange={(e) => patch({ servings: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Prep minutes</span>
            <input
              className={styles.input}
              inputMode="numeric"
              value={draft.prepMinutes}
              onChange={(e) => patch({ prepMinutes: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Cook minutes</span>
            <input
              className={styles.input}
              inputMode="numeric"
              value={draft.cookMinutes}
              onChange={(e) => patch({ cookMinutes: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Total minutes</span>
            <input
              className={styles.input}
              inputMode="numeric"
              value={draft.totalMinutes}
              onChange={(e) => patch({ totalMinutes: e.target.value })}
            />
          </label>
        </div>

        <fieldset className={styles.fieldset}>
          <legend className={styles.label}>Meal types</legend>
          <div className={styles.mealTypes}>
            {MEAL_TYPES.map((meal) => (
              <label key={meal} className={styles.check}>
                <input
                  type="checkbox"
                  checked={draft.mealTypes.includes(meal)}
                  onChange={(e) =>
                    patch({
                      mealTypes: e.target.checked
                        ? [...draft.mealTypes, meal]
                        : draft.mealTypes.filter((value) => value !== meal),
                    })
                  }
                />
                {meal}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className={styles.card}>
        <h2 className={styles.heading}>Tags</h2>
        <div className={styles.chips}>
          {draft.tags.map((tag) => (
            <span key={tag} className={styles.chip}>
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => patch({ tags: draft.tags.filter((value) => value !== tag) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className={styles.inline}>
          <input
            className={styles.input}
            list="recipe-tag-suggestions"
            placeholder="Add a tag"
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
          />
          <datalist id="recipe-tag-suggestions">
            {(tagSuggestions.data ?? []).map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
          <Button onClick={addTag}>Add tag</Button>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.heading}>Equipment, notes, source</h2>
        <label className={styles.field}>
          <span className={styles.label}>Equipment (comma separated)</span>
          <input
            className={styles.input}
            value={draft.equipment}
            onChange={(e) => patch({ equipment: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Notes</span>
          <textarea
            className={styles.textarea}
            rows={3}
            value={draft.notes}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </label>
        <div className={styles.pair}>
          <label className={styles.field}>
            <span className={styles.label}>Source name</span>
            <input
              className={styles.input}
              value={draft.sourceName}
              onChange={(e) => patch({ sourceName: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Source URL</span>
            <input
              className={styles.input}
              type="url"
              value={draft.sourceUrl}
              onChange={(e) => patch({ sourceUrl: e.target.value })}
            />
          </label>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.heading}>Ingredients</h2>
          <Button icon={<Icon name="plus" />} onClick={() => patch({ lines: [...draft.lines, emptyLine()] })}>
            Add line
          </Button>
        </div>
        <ol className={styles.rows}>
          {draft.lines.map((line, index) => (
            <li key={line.key} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.rowNum}>{index + 1}</span>
                <span className={styles.rowActions}>
                  <button type="button" aria-label="Move line up" onClick={() => patch({ lines: move(draft.lines, index, index - 1) })} disabled={index === 0}>
                    ↑
                  </button>
                  <button type="button" aria-label="Move line down" onClick={() => patch({ lines: move(draft.lines, index, index + 1) })} disabled={index === draft.lines.length - 1}>
                    ↓
                  </button>
                  <button type="button" aria-label="Remove line" onClick={() => patch({ lines: draft.lines.filter((item) => item.key !== line.key), steps: draft.steps.map((step) => ({ ...step, links: step.links.filter((link) => link.lineKey !== line.key) })) })}>
                    <Icon name="trash" />
                  </button>
                </span>
              </div>
              <div className={styles.lineGrid}>
                <label className={styles.field}>
                  <span className={styles.label}>Ingredient</span>
                  <input className={styles.input} value={line.name} onChange={(e) => patchLine(line.key, { name: e.target.value })} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Qty</span>
                  <input className={styles.input} inputMode="decimal" value={line.qty} onChange={(e) => patchLine(line.key, { qty: e.target.value })} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Max qty</span>
                  <input className={styles.input} inputMode="decimal" value={line.qtyMax} onChange={(e) => patchLine(line.key, { qtyMax: e.target.value })} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Unit</span>
                  <input className={styles.input} value={line.unit} onChange={(e) => patchLine(line.key, { unit: e.target.value })} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Prep note</span>
                  <input className={styles.input} value={line.prepNote} onChange={(e) => patchLine(line.key, { prepNote: e.target.value })} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Group</span>
                  <input className={styles.input} value={line.groupLabel} onChange={(e) => patchLine(line.key, { groupLabel: e.target.value })} />
                </label>
              </div>
              <div className={styles.checks}>
                <label className={styles.check}>
                  <input type="checkbox" checked={line.optional} onChange={(e) => patchLine(line.key, { optional: e.target.checked })} />
                  Optional
                </label>
                <label className={styles.check}>
                  <input type="checkbox" checked={line.scalingExempt} onChange={(e) => patchLine(line.key, { scalingExempt: e.target.checked })} />
                  Does not scale
                </label>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.heading}>Steps</h2>
          <Button icon={<Icon name="plus" />} onClick={() => patch({ steps: [...draft.steps, emptyStep()] })}>
            Add step
          </Button>
        </div>
        <ol className={styles.rows}>
          {draft.steps.map((step, index) => {
            const available = draft.lines.filter(
              (line) => line.name.trim() !== "" && !step.links.some((link) => link.lineKey === line.key),
            );
            return (
              <li key={step.key} className={styles.row}>
                <div className={styles.rowHead}>
                  <span className={styles.rowNum}>{index + 1}</span>
                  <span className={styles.rowActions}>
                    <button type="button" aria-label="Move step up" onClick={() => patch({ steps: move(draft.steps, index, index - 1) })} disabled={index === 0}>
                      ↑
                    </button>
                    <button type="button" aria-label="Move step down" onClick={() => patch({ steps: move(draft.steps, index, index + 1) })} disabled={index === draft.steps.length - 1}>
                      ↓
                    </button>
                    <button type="button" aria-label="Remove step" onClick={() => patch({ steps: draft.steps.filter((item) => item.key !== step.key) })}>
                      <Icon name="trash" />
                    </button>
                  </span>
                </div>
                <label className={styles.field}>
                  <span className={styles.label}>Instruction</span>
                  <textarea
                    className={styles.textarea}
                    rows={2}
                    value={step.text}
                    onChange={(e) => patchStep(step.key, { text: e.target.value })}
                  />
                </label>
                <div className={styles.pair}>
                  <label className={styles.field}>
                    <span className={styles.label}>Duration minutes</span>
                    <input className={styles.input} inputMode="numeric" value={step.durationMinutes} onChange={(e) => patchStep(step.key, { durationMinutes: e.target.value })} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Group</span>
                    <input className={styles.input} value={step.groupLabel} onChange={(e) => patchStep(step.key, { groupLabel: e.target.value })} />
                  </label>
                </div>

                {step.links.length > 0 && (
                  <ul className={styles.links}>
                    {step.links.map((link) => (
                      <li key={link.key} className={styles.linkRow}>
                        <span className={styles.linkName}>{lineName(link.lineKey) || "Ingredient line"}</span>
                        <input
                          className={styles.qtyInput}
                          inputMode="decimal"
                          placeholder="whole line"
                          aria-label={`Amount of ${lineName(link.lineKey)} used`}
                          value={link.qty}
                          onChange={(e) =>
                            patchStep(step.key, {
                              links: step.links.map((item) => (item.key === link.key ? { ...item, qty: e.target.value } : item)),
                            })
                          }
                        />
                        <button
                          type="button"
                          aria-label="Remove ingredient from step"
                          onClick={() => patchStep(step.key, { links: step.links.filter((item) => item.key !== link.key) })}
                        >
                          <Icon name="trash" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {available.length > 0 && (
                  <select
                    className={styles.input}
                    value=""
                    aria-label="Add an ingredient to this step"
                    onChange={(e) => addLink(step, e.target.value)}
                  >
                    <option value="">Add ingredient to step…</option>
                    {available.map((line) => (
                      <option key={line.key} value={line.key}>
                        {line.name}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {warnings.length > 0 && (
        <section className={styles.warning} role="status">
          <p className={styles.warningHead}>Check the step amounts</p>
          <ul>
            {warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
          <p>You can still save.</p>
        </section>
      )}

      {formError !== null && (
        <p className={styles.error} role="alert">
          {formError}
        </p>
      )}

      <div className={styles.actions}>
        <Link
          to={recipe === undefined ? "/recipes" : "/recipes/$slug"}
          {...(recipe === undefined ? {} : { params: { slug: recipe.slug } })}
          className={buttonClass({ size: "lg" })}
        >
          Cancel
        </Link>
        <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
          Save recipe
        </Button>
      </div>
    </form>
  );
}
