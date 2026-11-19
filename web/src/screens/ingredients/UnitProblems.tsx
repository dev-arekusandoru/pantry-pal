import { useState } from "react";
import { Button } from "@/ui";
import { MeasureForm } from "./MeasureForm";
import styles from "./Units.module.css";
import { unitText, type Measure, type UnitProblem } from "./units";

export interface UnitProblemsProps {
  problems: readonly UnitProblem[];
  /** Replace the offending unit with a suggested one. */
  onUseUnit?: (suggestion: string, problem: UnitProblem) => void;
  /** A measure was saved for the offending unit; the caller can try again. */
  onMeasureAdded?: (measure: Measure, problem: UnitProblem) => void;
}

/**
 * Inline answer to a rejected unit: what is wrong, the units that work, and
 * "Add a measure" for the unit that failed.
 */
export function UnitProblems({ problems, onUseUnit, onMeasureAdded }: UnitProblemsProps) {
  const [adding, setAdding] = useState<string | null>(null);
  if (problems.length === 0) return null;
  return (
    <div className={styles.root}>
      {problems.map((problem) => {
        const key = `${problem.ingredientId}:${problem.unit}`;
        return (
          <div key={key} className={styles.unitProblem} role="alert">
            <p className={styles.unitProblemText}>{problem.message}</p>
            {adding === key ? (
              <MeasureForm
                ingredientId={problem.ingredientId}
                unit={problem.unit}
                onCancel={() => setAdding(null)}
                onSaved={(measure) => {
                  setAdding(null);
                  onMeasureAdded?.(measure, problem);
                }}
              />
            ) : (
              <>
                <ul className={styles.suggestions} aria-label={`Units to use for ${problem.ingredientName}`}>
                  {onUseUnit !== undefined &&
                    problem.suggestions.map((suggestion) => (
                      <li key={suggestion}>
                        <Button onClick={() => onUseUnit(unitText(suggestion), problem)}>Use {unitText(suggestion)}</Button>
                      </li>
                    ))}
                  <li>
                    <Button variant="primary" onClick={() => setAdding(key)}>
                      Add a measure for {unitText(problem.unit)}
                    </Button>
                  </li>
                </ul>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
