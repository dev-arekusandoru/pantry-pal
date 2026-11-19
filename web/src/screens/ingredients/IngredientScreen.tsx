import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState, type FormEvent } from "react";
import { ApiError, errorMessage } from "@/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  IconPicker,
  PageHeader,
  Pill,
  Skeleton,
  Sticker,
  buttonClass,
  hasIcon,
  ingredientEmoji,
  toast,
} from "@/ui";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { CATEGORY_ORDER, aisleLabel, type IngredientCategory } from "../aisles";
import { STATUS_LABEL } from "../pantry/stock";
import { formatAmount } from "../shop/format";
import { DefaultPortionField } from "./DefaultPortionField";
import styles from "./Ingredient.module.css";
import { LinkSheet, MergeSheet, SplitSheet } from "./IngredientSheets";
import { MeasureForm } from "./MeasureForm";
import { MeasuresCard } from "./MeasuresCard";
import {
  useAcceptIngredient,
  useAddAlias,
  useArchiveIngredient,
  useIngredient,
  useLinkFood,
  useRemoveAlias,
  useUpdateIngredient,
  type IngredientDetail,
  type IngredientSuggestion,
  type UpdateIngredientBody,
} from "./queries";
import { ingredientErrorMessage, nameProblem, nameProblemText, type IngredientPick } from "./refs";
import { UnitPicker } from "./UnitPicker";
import { UnitProblems } from "./UnitProblems";
import { unitProblems, unitText, type UnitProblem } from "./units";
import { usePageEntry } from "./usePageEntry";

type Reason = NonNullable<IngredientDetail["review"]>["reasons"][number];

const REASONS: Record<Reason, { label: string; tone: "peach" | "gum" | "butter" }> = {
  unlinked: { label: "No USDA food", tone: "peach" },
  lint: { label: "Name needs a fix", tone: "gum" },
  custom_unreviewed: { label: "Custom, not reviewed", tone: "butter" },
  unit: { label: "Unit has no weight", tone: "peach" },
};

type Open = { sheet: "link" } | { sheet: "split" } | { sheet: "merge"; target: IngredientPick | null };

/** One ingredient: everything you can change about it, why it needs attention, and where it is used. */
export function IngredientScreen({ id }: { id: string }) {
  const query = useIngredient(id);
  const ingredient = query.data;
  usePageEntry(ingredient?.name);

  if (query.error && ingredient === undefined) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        <BackLink />
        {missing ? (
          <EmptyState
            emoji="empty-bowl"
            title="That ingredient is gone"
            action={
              <Link to="/ingredients" className={buttonClass({ variant: "primary" })}>
                See all ingredients
              </Link>
            }
          >
            It may have been merged into another ingredient.
          </EmptyState>
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </>
    );
  }

  if (ingredient === undefined) {
    return (
      <div aria-busy="true" aria-label="Loading the ingredient">
        <BackLink />
        <PageHeader title="Ingredient" />
        <div className={styles.page}>
          <Skeleton height={220} radius={24} />
          <Skeleton height={160} radius={24} />
        </div>
      </div>
    );
  }

  return <IngredientPage key={ingredient.id} ingredient={ingredient} />;
}

function BackLink() {
  return (
    <Link to="/ingredients" className={styles.back}>
      <Icon name="back" />
      All ingredients
    </Link>
  );
}

function IngredientPage({ ingredient }: { ingredient: IngredientDetail }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<Open | null>(null);
  const [archiving, setArchiving] = useState(false);
  const archive = useArchiveIngredient();
  const linked = ingredient.nutrition?.fdcId != null;
  const archived = ingredient.archivedAt !== null;

  function goTo(pick: IngredientPick) {
    void navigate({ to: "/ingredients/$id", params: { id: pick.id } });
  }

  return (
    <>
      <BackLink />
      <PageHeader
        title={ingredient.name}
        sub={`${aisleLabel(ingredient.category)} · ${linked ? "Linked to a USDA food" : "Custom ingredient"}`}
        aside={archived ? <Pill tone="neutral">Archived</Pill> : undefined}
      />
      <div className={styles.page}>
        {ingredient.review !== null && !archived && <AttentionCard ingredient={ingredient} onOpen={setOpen} />}
        <DetailsCard ingredient={ingredient} />
        <FoodCard ingredient={ingredient} onOpen={setOpen} />
        <MeasuresCard ingredient={ingredient} />
        <AliasesCard ingredient={ingredient} />
        <UsageCard ingredient={ingredient} />
        {!archived && (
          <Card as="section" radius="xl" className={styles.card} aria-labelledby="manage-h">
            <h2 id="manage-h" className={styles.heading}>
              Merge or archive
            </h2>
            <p className={styles.hint}>
              Merge moves everything that uses this ingredient to another one. Archive hides it from the list and keeps old recipes
              and history working.
            </p>
            <div className={styles.actions}>
              <Button onClick={() => setOpen({ sheet: "merge", target: null })}>Merge into…</Button>
              <Button variant="dangerGhost" icon={<Icon name="trash" />} onClick={() => setArchiving(true)}>
                Archive
              </Button>
            </div>
          </Card>
        )}
      </div>

      {open?.sheet === "link" && <LinkSheet ingredient={ingredient} onClose={() => setOpen(null)} />}
      {open?.sheet === "split" && <SplitSheet ingredient={ingredient} onClose={() => setOpen(null)} onSplit={goTo} />}
      {open?.sheet === "merge" && (
        <MergeSheet ingredient={ingredient} target={open.target} onClose={() => setOpen(null)} onMerged={goTo} />
      )}
      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        title={`Archive ${ingredient.name}?`}
        confirmLabel="Archive"
        cancelLabel="Keep it"
        pending={archive.isPending}
        onConfirm={() =>
          archive.mutate(ingredient.id, {
            onSuccess: () => {
              setArchiving(false);
              toast.show({ message: `${ingredient.name} archived` });
              void navigate({ to: "/ingredients" });
            },
            onError: (error) => {
              setArchiving(false);
              toast.error(errorMessage(error));
            },
          })
        }
      >
        {ingredient.name} leaves the ingredient list. Recipes that use it keep working. This cannot be undone in the app.
      </ConfirmDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

function AttentionCard({ ingredient, onOpen }: { ingredient: IngredientDetail; onOpen: (open: Open) => void }) {
  const review = ingredient.review;
  const accept = useAcceptIngredient();
  const link = useLinkFood();
  const linked = ingredient.nutrition?.fdcId != null;
  if (review === null) return null;

  return (
    <Card as="section" radius="xl" className={styles.attention} aria-labelledby="attention-h">
      <h2 id="attention-h" className={styles.heading}>
        Needs attention
      </h2>
      <ul className={styles.reasons} aria-label="Why it needs attention">
        {review.reasons.map((reason) => (
          <li key={reason}>
            <Pill tone={REASONS[reason].tone}>{REASONS[reason].label}</Pill>
          </li>
        ))}
      </ul>
      {review.lint !== undefined && <p className={styles.lint}>{nameProblemText(review.lint)}</p>}
      {review.units !== undefined && review.units.length > 0 && <UnitReasons ingredient={ingredient} units={review.units} />}

      {review.suggestions.length > 0 && (
        <div className={styles.suggestions}>
          <p className={styles.smallLabel}>Suggestions</p>
          <ul className={styles.suggestionList}>
            {review.suggestions.map((suggestion) => (
              <li key={suggestionKey(suggestion)}>
                {suggestion.kind === "ingredient" ? (
                  <Button
                    className={styles.suggestion}
                    onClick={() => onOpen({ sheet: "merge", target: { id: suggestion.ingredientId, name: suggestion.name } })}
                  >
                    <span>Merge into {suggestion.name}</span>
                  </Button>
                ) : (
                  <Button
                    className={styles.suggestion}
                    loading={link.isPending && link.variables?.fdcId === suggestion.fdcId}
                    disabled={link.isPending}
                    onClick={() =>
                      link.mutate(
                        { ingredientId: ingredient.id, fdcId: suggestion.fdcId },
                        {
                          onSuccess: () => toast.show({ message: `${ingredient.name} now uses ${suggestion.description}` }),
                          onError: (error) => toast.error(errorMessage(error)),
                        },
                      )
                    }
                  >
                    <span>Link to {suggestion.description}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.actions}>
        {!linked && <Button onClick={() => onOpen({ sheet: "link" })}>Link to a food</Button>}
        <Button onClick={() => onOpen({ sheet: "split" })}>Split</Button>
        <Button onClick={() => onOpen({ sheet: "merge", target: null })}>Merge into…</Button>
        {ingredient.needsReview && (
          <Button
            variant="ghost"
            icon={<Icon name="check" />}
            loading={accept.isPending}
            onClick={() =>
              accept.mutate(ingredient.id, {
                onSuccess: () => toast.show({ message: `${ingredient.name} kept as a custom ingredient` }),
                onError: (error) => toast.error(errorMessage(error)),
              })
            }
          >
            Keep as custom
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Units a recipe line or pantry row uses that cannot turn into grams or the stock unit. */
function UnitReasons({ ingredient, units }: { ingredient: IngredientDetail; units: string[] }) {
  const [adding, setAdding] = useState<string | null>(null);
  return (
    <div className={styles.suggestions}>
      <p className={styles.smallLabel}>Units with no weight</p>
      <p className={styles.hint}>
        {ingredient.name} cannot turn these units into grams or {ingredient.stockUnit === null ? "a stock unit" : unitText(ingredient.stockUnit)}.
        Nutrition and the pantry skip them until you add a measure.
      </p>
      <ul className={styles.reasonUnits}>
        {units.map((unit) => (
          <li key={unit}>
            {adding === unit ? (
              <MeasureForm
                ingredientId={ingredient.id}
                unit={unit}
                onCancel={() => setAdding(null)}
                onSaved={(saved) => {
                  setAdding(null);
                  toast.show({ message: `1 ${unitText(saved.unit)} of ${ingredient.name} is saved` });
                }}
              />
            ) : (
              <span className={styles.reasonUnit}>
                <b>{unitText(unit)}</b>
                <Button aria-label={`Add measure for ${unitText(unit)}`} onClick={() => setAdding(unit)}>
                  Add measure
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function suggestionKey(suggestion: IngredientSuggestion): string {
  return suggestion.kind === "ingredient" ? `i-${suggestion.ingredientId}` : `f-${suggestion.fdcId}`;
}

// ---------------------------------------------------------------------------
// Details form
// ---------------------------------------------------------------------------

function numberOrNull(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : "invalid";
}

function DetailsCard({ ingredient }: { ingredient: IngredientDetail }) {
  const update = useUpdateIngredient();
  const [name, setName] = useState(ingredient.name);
  const [category, setCategory] = useState<IngredientCategory>(ingredient.category);
  const [shelfText, setShelfText] = useState(ingredient.shelfLifeDays === null ? "" : String(ingredient.shelfLifeDays));
  const [parText, setParText] = useState(ingredient.parQty === null ? "" : String(ingredient.parQty));
  const [stockUnit, setStockUnit] = useState(ingredient.stockUnit === null ? "" : unitText(ingredient.stockUnit));
  const [unitIssues, setUnitIssues] = useState<UnitProblem[]>([]);
  const [notes, setNotes] = useState(ingredient.notes ?? "");
  const [problems, setProblems] = useState<{ name?: string; shelf?: string; par?: string; form?: string }>({});
  const [pickingIcon, setPickingIcon] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const shelfRef = useRef<HTMLInputElement>(null);
  const parRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const nameId = `${ids}-name`;
  const categoryId = `${ids}-category`;
  const shelfId = `${ids}-shelf`;
  const parId = `${ids}-par`;
  const stockHintId = `${ids}-stock-hint`;
  const notesId = `${ids}-notes`;
  const statusId = `${ids}-status`;
  const [saved, setSaved] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    setSaved("");
    const next: { name?: string; shelf?: string; par?: string } = {};
    const trimmedName = name.trim();
    if (trimmedName === "") next.name = "Enter a name.";
    const shelf = numberOrNull(shelfText);
    if (shelf === "invalid" || (shelf !== null && !Number.isInteger(shelf))) next.shelf = "Use a whole number of days, or leave it empty.";
    const par = numberOrNull(parText);
    if (par === "invalid") next.par = "Use a number, or leave it empty.";
    if (next.name !== undefined || next.shelf !== undefined || next.par !== undefined) {
      setProblems(next);
      (next.name !== undefined ? nameRef : next.shelf !== undefined ? shelfRef : parRef).current?.focus();
      return;
    }
    setProblems({});
    setUnitIssues([]);

    const changes: UpdateIngredientBody = {};
    if (trimmedName !== ingredient.name) changes.name = trimmedName;
    if (category !== ingredient.category) changes.category = category;
    if (shelf !== ingredient.shelfLifeDays) changes.shelfLifeDays = shelf as number | null;
    if (par !== ingredient.parQty) changes.parQty = par as number | null;
    const stock = stockUnit.trim() === "" ? null : stockUnit.trim();
    const stockChanged = stock !== (ingredient.stockUnit === null ? null : unitText(ingredient.stockUnit)) && stock !== ingredient.stockUnit;
    if (stockChanged) changes.stockUnit = stock;
    // A new par is written in the unit shown beside it, even when the stock unit changes in the same save.
    if (changes.parQty !== undefined && changes.parQty !== null && stock !== null && stockChanged) changes.parUnit = stock;
    const noteText = notes.trim() === "" ? null : notes.trim();
    if (noteText !== ingredient.notes) changes.notes = noteText;
    if (Object.keys(changes).length === 0) {
      setSaved("No changes to save.");
      return;
    }

    update.mutate(
      { ingredientId: ingredient.id, changes },
      {
        onSuccess: (saved) => {
          setName(saved.name);
          setNotes(saved.notes ?? "");
          setStockUnit(saved.stockUnit === null ? "" : unitText(saved.stockUnit));
          setParText(saved.parQty === null ? "" : String(saved.parQty));
          setSaved(`Saved ${saved.name}.`);
        },
        onError: (error) => {
          const issues = unitProblems(error);
          const problem = issues.length > 0 ? null : nameProblem(error);
          if (issues.length > 0) {
            setUnitIssues(issues);
            setProblems({ form: "The stock unit did not change. Nothing was saved." });
            return;
          }
          if (problem !== null) {
            setProblems({ name: nameProblemText(problem) });
            nameRef.current?.focus();
          } else if (error instanceof ApiError && error.status === 409) {
            setProblems({ name: error.message });
            nameRef.current?.focus();
          } else {
            setProblems({ form: ingredientErrorMessage(error, "Could not save the changes.") });
          }
        },
      },
    );
  }

  return (
    <Card as="section" radius="xl" className={styles.card} aria-labelledby="details-h">
      <h2 id="details-h" className={styles.heading}>
        Details
      </h2>
      <div className={styles.iconRow}>
        <Sticker
          emoji={ingredientEmoji(ingredient.name, ingredient.imageUrl)}
          fallback={ingredientEmoji(ingredient.name)}
          tone="plain"
          size={56}
          className={hasIcon(ingredient.name, ingredient.imageUrl) ? undefined : styles.noIcon}
        />
        <div className={styles.iconText}>
          <b>Icon</b>
          <small>{hasIcon(ingredient.name, ingredient.imageUrl) ? "Shown in the pantry, recipes and shopping lists." : "This ingredient has no icon yet."}</small>
        </div>
        <Button onClick={() => setPickingIcon(true)}>Change icon</Button>
      </div>

      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={nameId}>
            Name
          </label>
          <input
            ref={nameRef}
            id={nameId}
            className={styles.input}
            value={name}
            autoComplete="off"
            aria-invalid={problems.name !== undefined || undefined}
            aria-describedby={`${nameId}-hint${problems.name === undefined ? "" : ` ${nameId}-problem`}`}
            onChange={(event) => {
              setName(event.target.value);
              setProblems((current) => ({ ...current, name: undefined }));
            }}
          />
          <p id={`${nameId}-hint`} className={styles.hint}>
            One plain name. It is saved in Title Case. Put sizes in the recipe unit and preparation in the prep note.
          </p>
          {problems.name !== undefined && (
            <p id={`${nameId}-problem`} className={styles.problem}>
              {problems.name}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={categoryId}>
            Aisle
          </label>
          <select
            id={categoryId}
            className={styles.select}
            value={category}
            onChange={(event) => setCategory(event.target.value as IngredientCategory)}
          >
            {CATEGORY_ORDER.map((value) => (
              <option key={value} value={value}>
                {aisleLabel(value)}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <UnitPicker
            label="Stock unit"
            ingredientId={ingredient.id}
            value={stockUnit}
            onChange={(unit) => {
              setStockUnit(unit);
              setUnitIssues([]);
            }}
            describedBy={stockHintId}
          />
          <p id={stockHintId} className={styles.hint}>
            Pantry amounts and the minimum use this unit. Changing it converts what is in the pantry, or says which measure is missing.
          </p>
          <UnitProblems
            problems={unitIssues}
            onUseUnit={(unit) => {
              setStockUnit(unit);
              setUnitIssues([]);
            }}
            onMeasureAdded={() => {
              setUnitIssues([]);
              setProblems({});
            }}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={parId}>
            Keep at least{stockUnit.trim() === "" ? "" : ` (${stockUnit.trim()})`}
          </label>
          <input
            ref={parRef}
            id={parId}
            className={styles.input}
            inputMode="decimal"
            autoComplete="off"
            placeholder="No minimum"
            value={parText}
            aria-invalid={problems.par !== undefined || undefined}
            aria-describedby={problems.par === undefined ? undefined : `${parId}-problem`}
            onChange={(event) => setParText(event.target.value)}
          />
        </div>
        {problems.par !== undefined && (
          <p id={`${parId}-problem`} className={styles.problem}>
            {problems.par}
          </p>
        )}
        <p className={styles.hint}>The pantry marks this ingredient as running low at or under the minimum.</p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={shelfId}>
            Shelf life in days
          </label>
          <input
            ref={shelfRef}
            id={shelfId}
            className={styles.input}
            inputMode="numeric"
            autoComplete="off"
            placeholder="No shelf life"
            value={shelfText}
            aria-invalid={problems.shelf !== undefined || undefined}
            aria-describedby={problems.shelf === undefined ? undefined : `${shelfId}-problem`}
            onChange={(event) => setShelfText(event.target.value)}
          />
          {problems.shelf !== undefined && (
            <p id={`${shelfId}-problem`} className={styles.problem}>
              {problems.shelf}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={notesId}>
            Notes
          </label>
          <textarea
            id={notesId}
            className={styles.input}
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        {problems.form !== undefined && (
          <p className={styles.problem} role="alert">
            {problems.form}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={update.isPending}>
            Save changes
          </Button>
          <p id={statusId} className={styles.saved} role="status">
            {saved}
          </p>
        </div>
      </form>

      <IconPicker
        ingredient={pickingIcon ? { id: ingredient.id, name: ingredient.name, imageUrl: ingredient.imageUrl } : null}
        onClose={() => setPickingIcon(false)}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// USDA food
// ---------------------------------------------------------------------------

function FoodCard({ ingredient, onOpen }: { ingredient: IngredientDetail; onOpen: (open: Open) => void }) {
  const nutrition = ingredient.nutrition;
  const linked = nutrition?.fdcId != null;
  return (
    <Card as="section" radius="xl" className={styles.card} aria-labelledby="food-h">
      <h2 id="food-h" className={styles.heading}>
        USDA food
      </h2>
      {linked ? (
        <>
          <p className={styles.food}>
            <b>{nutrition?.description}</b>
            <span>
              {nutrition?.per100g?.calories == null ? "Calories unknown" : `${Math.round(nutrition.per100g.calories)} kcal per 100 g`}
            </span>
          </p>
          <p className={styles.hint}>The food gives this ingredient its nutrition in every recipe.</p>
          <DefaultPortionField ingredientId={ingredient.id} />
          <div className={styles.actions}>
            <Button onClick={() => onOpen({ sheet: "link" })}>Change food</Button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.hint}>
            This is a custom ingredient with no nutrition data. Link a USDA food to count it in recipe nutrition.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => onOpen({ sheet: "link" })}>
              Link to a food
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

function AliasesCard({ ingredient }: { ingredient: IngredientDetail }) {
  const add = useAddAlias();
  const remove = useRemoveAlias();
  const [alias, setAlias] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = alias.trim();
    if (text === "") {
      setProblem("Enter another name.");
      inputRef.current?.focus();
      return;
    }
    setProblem(null);
    add.mutate(
      { ingredientId: ingredient.id, alias: text },
      {
        onSuccess: () => {
          setAlias("");
          toast.show({ message: `${text.toLowerCase()} now finds ${ingredient.name}` });
          inputRef.current?.focus();
        },
        onError: (error) => {
          setProblem(ingredientErrorMessage(error, "Could not add the name."));
          inputRef.current?.focus();
        },
      },
    );
  }

  return (
    <Card as="section" radius="xl" className={styles.card} aria-labelledby="aliases-h">
      <h2 id="aliases-h" className={styles.heading}>
        Other names
      </h2>
      <p className={styles.hint}>A recipe line or pantry entry that uses one of these names points to {ingredient.name}.</p>
      {ingredient.aliases.length > 0 && (
        <ul className={styles.chips} aria-label="Other names">
          {ingredient.aliases.map((item) => (
            <li key={item.id} className={styles.chip}>
              <span>{item.alias}</span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`Remove ${item.alias}`}
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(
                    { ingredientId: ingredient.id, aliasId: item.id },
                    { onError: (error) => toast.error(errorMessage(error)) },
                  )
                }
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className={styles.aliasForm} onSubmit={submit} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={inputId}>
            Add another name
          </label>
          <input
            ref={inputRef}
            id={inputId}
            className={styles.input}
            value={alias}
            autoComplete="off"
            placeholder="scallion"
            aria-invalid={problem !== null || undefined}
            aria-describedby={problem === null ? undefined : `${inputId}-problem`}
            onChange={(event) => {
              setAlias(event.target.value);
              setProblem(null);
            }}
          />
        </div>
        <Button type="submit" loading={add.isPending}>
          Add name
        </Button>
      </form>
      {problem !== null && (
        <p id={`${inputId}-problem`} className={styles.problem}>
          {problem}
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Used in
// ---------------------------------------------------------------------------

function UsageCard({ ingredient }: { ingredient: IngredientDetail }) {
  const { recipes, pantryItem, shoppingItems, rules } = ingredient.usage;
  const unused = recipes.length === 0 && pantryItem === null && shoppingItems.length === 0 && rules.length === 0;
  return (
    <Card as="section" radius="xl" className={styles.card} aria-labelledby="usage-h">
      <h2 id="usage-h" className={styles.heading}>
        Used in
      </h2>
      {unused && <p className={styles.hint}>Nothing uses {ingredient.name} yet. Add it to a recipe, the pantry or a shopping list.</p>}

      <h3 className={styles.subheading}>Recipes</h3>
      {recipes.length === 0 ? (
        <p className={styles.none}>No recipes</p>
      ) : (
        <ul className={styles.usageList}>
          {recipes.map((recipe) => (
            <li key={recipe.id}>
              <Link to="/recipes/$slug" params={{ slug: recipe.slug }} className={styles.usageLink}>
                <span className={styles.usageName}>{recipe.title}</span>
                <span className={styles.usageMeta}>
                  {recipe.lines} {recipe.lines === 1 ? "line" : "lines"}
                  {recipe.asMain > 0 && <Pill tone="pistachio">Main</Pill>}
                  {recipe.asAlternative > 0 && <Pill tone="blue">Alternative</Pill>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h3 className={styles.subheading}>Pantry</h3>
      {pantryItem === null ? (
        <p className={styles.none}>Not in the pantry</p>
      ) : (
        <ul className={styles.usageList}>
          <li>
            <Link to="/pantry" className={styles.usageLink}>
              <span className={styles.usageName}>
                {pantryItem.qty === null ? "In the pantry" : formatAmount(pantryItem.qty, pantryItem.unit)}
              </span>
              <span className={styles.usageMeta}>{STATUS_LABEL[pantryItem.status]}</span>
            </Link>
          </li>
        </ul>
      )}

      <h3 className={styles.subheading}>Shopping lists</h3>
      {shoppingItems.length === 0 ? (
        <p className={styles.none}>Not on an open list</p>
      ) : (
        <ul className={styles.usageList}>
          {shoppingItems.map((item) => (
            <li key={item.itemId}>
              <Link to="/shop" search={{ list: item.listId }} className={styles.usageLink}>
                <span className={styles.usageName}>{item.listTitle}</span>
                <span className={styles.usageMeta}>
                  {formatAmount(item.qty, item.unit) || "No amount"}
                  {item.checked && <Pill tone="pistachio">In the basket</Pill>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h3 className={styles.subheading}>Dietary rules</h3>
      {rules.length === 0 ? (
        <p className={styles.none}>No rules</p>
      ) : (
        <ul className={styles.usageList}>
          {rules.map((rule) => (
            <li key={rule.id} className={styles.usageStatic}>
              <span className={styles.usageName}>{rule.reason ?? rule.conditionNote ?? "Rule"}</span>
              <span className={styles.usageMeta}>
                <Pill tone={rule.severity === "forbidden" ? "danger" : "butter"}>{rule.severity}</Pill>
                {rule.memberId === null ? "Whole household" : "One person"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
