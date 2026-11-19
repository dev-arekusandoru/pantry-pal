import { useId, useRef, useState, type KeyboardEvent } from "react";
import { errorMessage } from "@/api";
import { Button } from "@/ui";
import { useSetMeasure } from "./queries";
import styles from "./Units.module.css";
import { unitText, type Measure } from "./units";

export interface MeasureFormProps {
  ingredientId: string;
  /** The unit being measured ("cup"). Omit it to let the person type a new unit. */
  unit?: string;
  initialGrams?: number;
  title?: string;
  saveLabel?: string;
  /** Called with the measure the server saved; its `unit` is the normalized name. */
  onSaved: (measure: Measure) => void;
  onCancel: () => void;
}

/**
 * "1 cup = 30 g": gives one unit of an ingredient a weight. It is a group, not a
 * <form>, so it can sit inside the recipe editor and the pantry sheets, which are forms.
 */
export function MeasureForm({ ingredientId, unit, initialGrams, title = "Add a measure", saveLabel = "Save measure", onSaved, onCancel }: MeasureFormProps) {
  const set = useSetMeasure();
  const [typedUnit, setUnitText] = useState(unit ?? "");
  const [gramsText, setGramsText] = useState(initialGrams === undefined ? "" : String(initialGrams));
  const [problem, setProblem] = useState<string | null>(null);
  const unitRef = useRef<HTMLInputElement>(null);
  const gramsRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const problemId = `${id}-problem`;

  function save() {
    if (set.isPending) return;
    const name = (unit ?? typedUnit).trim();
    if (name === "") {
      setProblem("Enter a unit, such as handful.");
      unitRef.current?.focus();
      return;
    }
    const grams = Number(gramsText.trim().replace(",", "."));
    if (gramsText.trim() === "" || !Number.isFinite(grams) || grams <= 0) {
      setProblem("Enter the weight of one unit in grams, more than 0.");
      gramsRef.current?.focus();
      return;
    }
    setProblem(null);
    set.mutate(
      { ingredientId, unit: name, grams },
      {
        onSuccess: onSaved,
        onError: (error) => {
          setProblem(errorMessage(error));
          gramsRef.current?.focus();
        },
      },
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  }

  return (
    <div className={styles.measureForm} role="group" aria-labelledby={`${id}-title`}>
      <p id={`${id}-title`} className={styles.formTitle}>
        {title}
      </p>
      <div className={styles.equation}>
        {unit === undefined ? (
          <>
            <span className={styles.equationText}>1</span>
            <div className={styles.fieldNarrow}>
            <label className={styles.label} htmlFor={`${id}-unit`}>
              Unit
            </label>
            <input
              ref={unitRef}
              id={`${id}-unit`}
              className={styles.input}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="handful"
              value={typedUnit}
              aria-describedby={problem === null ? undefined : problemId}
              onChange={(event) => setUnitText(event.target.value)}
              onKeyDown={onKeyDown}
            />
            </div>
            <span className={styles.equationText}>=</span>
          </>
        ) : (
          <span className={styles.equationText}>1 {unitText(unit)} =</span>
        )}
        <div className={styles.fieldNarrow}>
          <label className={styles.label} htmlFor={`${id}-grams`}>
            Weight in grams
          </label>
          <input
            ref={gramsRef}
            id={`${id}-grams`}
            className={styles.input}
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            placeholder="30"
            value={gramsText}
            aria-invalid={problem !== null || undefined}
            aria-describedby={problem === null ? undefined : problemId}
            onChange={(event) => {
              setGramsText(event.target.value);
              setProblem(null);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <span className={styles.equationText}>g</span>
      </div>
      {problem !== null && (
        <p id={problemId} className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <div className={styles.formActions}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" loading={set.isPending} onClick={save}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
