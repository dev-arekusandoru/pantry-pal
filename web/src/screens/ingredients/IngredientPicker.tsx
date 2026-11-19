import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { VisuallyHidden } from "radix-ui";
import { errorMessage } from "@/api";
import { Button, Emoji, Pill, cx, ingredientEmoji } from "@/ui";
import { CATEGORY_ORDER, aisleLabel } from "../aisles";
import styles from "./IngredientPicker.module.css";
import {
  fetchIngredientPick,
  useCreateIngredient,
  useDebounced,
  useFindIngredients,
  type FoundFood,
  type FoundIngredient,
} from "./queries";
import { nameProblem, nameProblemText, type IngredientCategory, type IngredientPick } from "./refs";

export interface IngredientPickerProps {
  /** Visible label, also the accessible name of the search box. */
  label: string;
  value: IngredientPick | null;
  onChange: (pick: IngredientPick) => void;
  placeholder?: string;
  /** Text to search for when the box first opens. */
  initialQuery?: string;
  autoFocus?: boolean;
  /** Ingredient ids that cannot be chosen, for example the main ingredient of a line. */
  exclude?: ReadonlySet<string>;
  className?: string;
}

type Option =
  | { key: string; kind: "ingredient"; ingredient: FoundIngredient }
  | { key: string; kind: "food"; food: FoundFood }
  | { key: string; kind: "custom" };

type Draft =
  | { kind: "food"; food: FoundFood; name: string; category: IngredientCategory }
  | { kind: "custom"; name: string; category: IngredientCategory };

/**
 * Search box for choosing one ingredient. It lists the household's ingredients,
 * then USDA foods, then "Create custom…". A food or a custom ingredient is
 * created before it is returned, so the caller always gets an ingredient id.
 *
 * Combobox pattern: the input owns focus, arrow keys move through the options
 * and Enter picks one. The list sits in the page flow (not a popover), so it
 * works inside a sheet and on a narrow screen without clipping.
 */
export function IngredientPicker({
  label,
  value,
  onChange,
  placeholder = "Search ingredients and foods",
  initialQuery = "",
  autoFocus,
  exclude,
  className,
}: IngredientPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [changing, setChanging] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const create = useCreateIngredient();
  const id = useId();
  const listId = `${id}-list`;
  const labelId = `${id}-label`;
  const inputId = `${id}-input`;
  const problemId = `${id}-problem`;

  const trimmed = query.trim();
  const found = useFindIngredients(useDebounced(query, 200));
  const searching = trimmed !== "" && (found.isPending || found.isPlaceholderData);
  const ready = found.data !== undefined;

  const options = useMemo<Option[]>(() => {
    if (trimmed === "") return [];
    const data = found.data;
    const ingredients = (data?.ingredients ?? []).filter((ingredient) => !exclude?.has(ingredient.id));
    const owned = new Set((data?.ingredients ?? []).map((ingredient) => ingredient.id));
    // A food the household already has an ingredient for is shown as that ingredient.
    const foods = (data?.foods ?? []).filter(
      (food) => food.ingredientId === null || (!owned.has(food.ingredientId) && !exclude?.has(food.ingredientId)),
    );
    return [
      ...ingredients.map<Option>((ingredient) => ({ key: `i-${ingredient.id}`, kind: "ingredient", ingredient })),
      ...foods.map<Option>((food) => ({ key: `f-${food.fdcId}`, kind: "food", food })),
      { key: "custom", kind: "custom" },
    ];
  }, [found.data, trimmed, exclude]);

  const ingredientOptions = options.filter((option) => option.kind === "ingredient");
  const foodOptions = options.filter((option) => option.kind === "food");
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));
  const activeKey = open && options.length > 0 ? options[activeIndex]?.key : undefined;

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (activeKey === undefined) return;
    document.getElementById(`${id}-${activeKey}`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeKey, id]);

  const showSelected = value !== null && !changing && draft === null;
  const message =
    trimmed === ""
      ? ""
      : searching && !ready
        ? "Searching"
        : found.isError
          ? "Search failed"
          : `${ingredientOptions.length} ${ingredientOptions.length === 1 ? "ingredient" : "ingredients"}, ${foodOptions.length} ${foodOptions.length === 1 ? "food" : "foods"}`;

  function finish(pick: IngredientPick) {
    setQuery("");
    setOpen(false);
    setChanging(false);
    setDraft(null);
    setProblem(null);
    onChange(pick);
  }

  /** Leave "change" mode, back to the chosen ingredient. `refocus` is false when focus already moved away. */
  function cancelChange(refocus = true) {
    setOpen(false);
    if (value === null) return;
    setChanging(false);
    setQuery("");
    if (refocus) window.setTimeout(() => rootRef.current?.querySelector("button")?.focus(), 0);
  }

  async function choose(option: Option) {
    if (picking) return;
    if (option.kind === "ingredient") {
      finish({ id: option.ingredient.id, name: option.ingredient.name });
      return;
    }
    if (option.kind === "custom") {
      setProblem(null);
      setDraft({ kind: "custom", name: trimmed, category: "other" });
      return;
    }
    const { food } = option;
    if (food.ingredientId !== null) {
      setPicking(true);
      try {
        finish(await fetchIngredientPick(food.ingredientId));
      } catch (error) {
        setProblem(errorMessage(error));
      } finally {
        setPicking(false);
      }
      return;
    }
    setProblem(null);
    setDraft({ kind: "food", food, name: food.suggestedName, category: "other" });
  }

  function submitDraft() {
    if (draft === null || create.isPending) return;
    const name = draft.name.trim();
    if (name === "") {
      setProblem("Give the ingredient a name.");
      return;
    }
    setProblem(null);
    create.mutate(
      draft.kind === "food"
        ? { kind: "food", fdcId: draft.food.fdcId, name, category: draft.category }
        : { kind: "custom", name, category: draft.category },
      {
        onSuccess: finish,
        onError: (error) => {
          const rule = nameProblem(error);
          setProblem(rule === null ? errorMessage(error) : nameProblemText(rule));
        },
      },
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      if (!open) return;
      // The picker usually sits in a form; Enter chooses, it never submits.
      event.preventDefault();
      const option = options[activeIndex];
      if (option !== undefined) void choose(option);
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else if (changing) {
        event.preventDefault();
        cancelChange();
      }
    }
  }

  if (draft !== null) {
    const nameId = `${id}-name`;
    const aisleId = `${id}-aisle`;
    return (
      <div ref={rootRef} className={cx(styles.root, className)}>
        <div className={styles.draft} role="group" aria-labelledby={`${id}-draft-title`}>
          <p id={`${id}-draft-title`} className={styles.draftTitle}>
            {draft.kind === "food" ? "Add this food as an ingredient" : "Create a custom ingredient"}
          </p>
          {draft.kind === "food" ? (
            <p className={styles.note}>
              USDA food: <b>{draft.food.description}</b>
            </p>
          ) : (
            <p className={styles.note}>
              A custom ingredient has no nutrition data. Use it only when no USDA food fits.
            </p>
          )}
          <div className={styles.field}>
            <label className={styles.label} htmlFor={nameId}>
              Ingredient name
            </label>
            <input
              id={nameId}
              className={styles.input}
              value={draft.name}
              autoComplete="off"
              autoFocus
              aria-invalid={problem !== null || undefined}
              aria-describedby={problem === null ? undefined : problemId}
              onChange={(event) => {
                setProblem(null);
                setDraft({ ...draft, name: event.target.value });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitDraft();
                }
              }}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={aisleId}>
              Shopping aisle
            </label>
            <select
              id={aisleId}
              className={cx(styles.input, styles.select)}
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value as IngredientCategory })}
            >
              {CATEGORY_ORDER.map((category) => (
                <option key={category} value={category}>
                  {aisleLabel(category)}
                </option>
              ))}
            </select>
          </div>
          {problem !== null && (
            <p id={problemId} className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <div className={styles.draftActions}>
            <Button
              onClick={() => {
                setDraft(null);
                setProblem(null);
                window.setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              Back to search
            </Button>
            <Button variant="primary" loading={create.isPending} onClick={submitDraft}>
              {draft.kind === "food" ? "Add ingredient" : "Create ingredient"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (showSelected) {
    return (
      <div ref={rootRef} className={cx(styles.root, className)}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        <div className={styles.selected} role="group" aria-labelledby={labelId}>
          <Emoji code={ingredientEmoji(value.name)} fallback={ingredientEmoji(value.name)} size={24} />
          <span className={styles.selectedName}>{value.name}</span>
          <Button
            className={styles.change}
            aria-label={`Change ${label.toLowerCase()}: ${value.name}`}
            onClick={() => {
              setChanging(true);
              setQuery("");
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            Change
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={cx(styles.root, className)}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          if (changing && value !== null) cancelChange(false);
        }
      }}
    >
      <label id={labelId} htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className={styles.input}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeKey === undefined ? undefined : `${id}-${activeKey}`}
        aria-describedby={problem === null ? undefined : problemId}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <VisuallyHidden.Root role="status">{message}</VisuallyHidden.Root>
      {problem !== null && (
        <p id={problemId} className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      {open && trimmed !== "" && (
        <div
          id={listId}
          role="listbox"
          aria-label={`${label} matches`}
          aria-busy={searching || undefined}
          className={styles.list}
          // Dragging the list's scrollbar must not blur the search box, or the list would close.
          onMouseDown={(event) => event.preventDefault()}
        >
          {found.isError ? (
            <p className={styles.empty}>Could not search. Check the connection and try again.</p>
          ) : (
            <>
              {ingredientOptions.length > 0 && (
                <Section title="Your ingredients" id={`${id}-yours`}>
                  {ingredientOptions.map((option) =>
                    option.kind === "ingredient" ? (
                      <OptionRow
                        key={option.key}
                        id={`${id}-${option.key}`}
                        active={option.key === activeKey}
                        onPick={() => void choose(option)}
                        onHover={() => setActive(options.indexOf(option))}
                      >
                        <span className={styles.optionName}>{option.ingredient.name}</span>
                        <span className={styles.optionMeta}>
                          {aisleLabel(option.ingredient.category)}
                          {!option.ingredient.linked && <Pill tone="butter">Custom</Pill>}
                        </span>
                      </OptionRow>
                    ) : null,
                  )}
                </Section>
              )}
              {foodOptions.length > 0 && (
                <Section title="USDA foods" id={`${id}-foods`}>
                  {foodOptions.map((option) =>
                    option.kind === "food" ? (
                      <OptionRow
                        key={option.key}
                        id={`${id}-${option.key}`}
                        active={option.key === activeKey}
                        onPick={() => void choose(option)}
                        onHover={() => setActive(options.indexOf(option))}
                      >
                        <span className={styles.optionName}>{option.food.suggestedName}</span>
                        <span className={styles.optionMeta}>{option.food.description}</span>
                      </OptionRow>
                    ) : null,
                  )}
                </Section>
              )}
              {searching && !ready && <p className={styles.empty}>Searching…</p>}
              {ready && ingredientOptions.length === 0 && foodOptions.length === 0 && (
                <p className={styles.empty}>No ingredient or USDA food matches “{trimmed}”.</p>
              )}
              <div className={cx(styles.group, styles.create)} role="group" aria-label="Create">
                <OptionRow
                  id={`${id}-custom`}
                  active={activeKey === "custom"}
                  onPick={() => void choose({ key: "custom", kind: "custom" })}
                  onHover={() => setActive(options.length - 1)}
                >
                  <span className={styles.optionName}>Create custom…</span>
                  <span className={styles.optionMeta}>Only when no food above fits</span>
                </OptionRow>
              </div>
            </>
          )}
        </div>
      )}
      {changing && value !== null && (
        <Button variant="ghost" className={styles.cancel} onClick={() => cancelChange()}>
          Keep {value.name}
        </Button>
      )}
    </div>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <div className={styles.group} role="group" aria-labelledby={id}>
      <div id={id} className={styles.groupTitle}>
        {title}
      </div>
      {children}
    </div>
  );
}

function OptionRow({
  id,
  active,
  onPick,
  onHover,
  children,
}: {
  id: string;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      className={cx(styles.option, active && styles.active)}
      // Keep focus in the search box; a click still picks.
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={onHover}
      onClick={onPick}
    >
      {children}
    </div>
  );
}
