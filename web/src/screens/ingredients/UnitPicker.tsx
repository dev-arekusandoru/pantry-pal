import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { VisuallyHidden } from "radix-ui";
import { cx } from "@/ui";
import { MeasureForm } from "./MeasureForm";
import { useIngredient } from "./queries";
import styles from "./Units.module.css";
import { formatGramsOf, matchUnit, unitText } from "./units";

export interface UnitPickerProps {
  /** Visible label, also the accessible name of the box. */
  label: string;
  /** Hide the label visually; it stays the accessible name. */
  hideLabel?: boolean;
  /** The ingredient whose units are offered: its stock unit, its measures, then the built-in units. */
  ingredientId: string;
  /** The unit as typed or picked. The server normalizes it ("cups" is cup). */
  value: string;
  onChange: (unit: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /** Id of text that describes the field, for example an error. */
  describedBy?: string;
  invalid?: boolean;
}

type Option = { key: string; kind: "unit"; unit: string } | { key: string; kind: "add" };

/**
 * Combobox for choosing a unit of one ingredient. A unit the ingredient does not
 * have yet offers "Add a measure: 1 <unit> = ? g", which opens a small form and
 * then selects the unit. The list sits in the page flow (not a popover) so it works
 * inside a sheet; the input keeps focus and arrow keys move through the options.
 */
export function UnitPicker({
  label,
  hideLabel,
  ingredientId,
  value,
  onChange,
  placeholder = "cup, oz, can",
  autoFocus,
  className,
  describedBy,
  invalid,
}: UnitPickerProps) {
  const ingredient = useIngredient(ingredientId);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /** Narrow the list only after typing; opening it shows every unit. */
  const [filtering, setFiltering] = useState(false);
  const [adding, setAdding] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const id = useId();
  const listId = `${id}-list`;
  const inputId = `${id}-input`;

  const units = useMemo(() => ingredient.data?.units ?? [], [ingredient.data]);
  const measures = useMemo(() => new Map((ingredient.data?.measures ?? []).map((measure) => [measure.unit, measure])), [ingredient.data]);
  const stockUnit = ingredient.data?.stockUnit ?? null;
  const typed = value.trim();
  const unknown = typed !== "" && ingredient.data !== undefined && matchUnit(typed, units) === null;

  const options = useMemo<Option[]>(() => {
    const query = filtering ? typed.toLowerCase() : "";
    const shown = units.filter((unit) => query === "" || unit.includes(query) || unitText(unit).includes(query));
    return [
      ...shown.map<Option>((unit) => ({ key: `u-${unit}`, kind: "unit", unit })),
      ...(unknown ? [{ key: "add", kind: "add" } as const] : []),
    ];
  }, [units, filtering, typed, unknown]);

  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));
  const activeKey = open && options.length > 0 ? options[activeIndex]?.key : undefined;

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    if (activeKey === undefined) return;
    document.getElementById(`${id}-${activeKey}`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeKey, id]);

  function pick(option: Option) {
    if (option.kind === "add") {
      setAdding(true);
      setOpen(false);
      return;
    }
    onChange(unitText(option.unit));
    setFiltering(false);
    setOpen(false);
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
      // The picker usually sits in a form; Enter chooses an open option and never submits then.
      if (!open) return;
      const option = options[activeIndex];
      if (option === undefined) return;
      event.preventDefault();
      pick(option);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  }

  const message = open
    ? `${options.filter((option) => option.kind === "unit").length} units${unknown ? ", add a measure available" : ""}`
    : "";

  return (
    <div
      ref={rootRef}
      className={cx(styles.root, className)}
      onFocus={() => window.clearTimeout(closeTimer.current)}
      onBlur={(event) => {
        if (rootRef.current?.contains(event.relatedTarget as Node | null)) return;
        // Closing the list moves what sits below it. Wait out the click that caused the blur, so a press on a
        // button under the list still lands on that button.
        closeTimer.current = window.setTimeout(() => setOpen(false), 250);
      }}
    >
      {hideLabel ? (
        <VisuallyHidden.Root asChild>
          <label htmlFor={inputId}>{label}</label>
        </VisuallyHidden.Root>
      ) : (
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
      )}
      <input
        ref={inputRef}
        id={inputId}
        className={styles.input}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeKey === undefined ? undefined : `${id}-${activeKey}`}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setActive(0);
          setFiltering(true);
          setOpen(true);
          setAdding(false);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <VisuallyHidden.Root role="status">{message}</VisuallyHidden.Root>
      {open && options.length > 0 && (
        <div
          id={listId}
          role="listbox"
          aria-label={`${label} options`}
          className={styles.list}
          // Dragging the list's scrollbar must not blur the box, or the list would close.
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.map((option, index) =>
            option.kind === "unit" ? (
              <div
                key={option.key}
                id={`${id}-${option.key}`}
                role="option"
                aria-selected={option.key === activeKey}
                className={cx(styles.option, option.key === activeKey && styles.active)}
                onMouseMove={() => setActive(index)}
                onClick={() => pick(option)}
              >
                <span className={styles.optionName}>{unitText(option.unit)}</span>
                <span className={styles.optionMeta}>{optionMeta(option.unit, stockUnit, measures.get(option.unit))}</span>
              </div>
            ) : (
              <div
                key={option.key}
                id={`${id}-${option.key}`}
                role="option"
                aria-selected={option.key === activeKey}
                className={cx(styles.option, styles.add, option.key === activeKey && styles.active)}
                onMouseMove={() => setActive(index)}
                onClick={() => pick(option)}
              >
                <span className={styles.optionName}>Add a measure: 1 {typed} = ? g</span>
              </div>
            ),
          )}
        </div>
      )}
      {adding && typed !== "" && (
        <MeasureForm
          ingredientId={ingredientId}
          unit={typed}
          onCancel={() => {
            setAdding(false);
            inputRef.current?.focus();
          }}
          onSaved={(measure) => {
            onChange(unitText(measure.unit));
            setAdding(false);
            setFiltering(false);
            inputRef.current?.focus();
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function optionMeta(unit: string, stockUnit: string | null, measure: { grams: number; estimated: boolean } | undefined): string {
  const parts: string[] = [];
  if (unit === stockUnit) parts.push("Stock unit");
  if (measure !== undefined) parts.push(`${formatGramsOf(measure.grams)}${measure.estimated ? " (estimated)" : ""}`);
  return parts.join(" · ");
}
