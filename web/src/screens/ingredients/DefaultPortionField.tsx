import { useId } from "react";
import { toast } from "@/ui";
import { errorMessage } from "@/api";
import styles from "./DefaultPortionField.module.css";
import { useIngredient, useSetDefaultPortion } from "./queries";

const AUTOMATIC = "";

const grams = (value: number) => `${Math.round(value * 10) / 10} g`;

/**
 * "A plain count means": which portion of the linked food an amount without a
 * unit stands for, for example a large egg. Renders nothing for an ingredient
 * with no linked food or no portions.
 */
export function DefaultPortionField({ ingredientId }: { ingredientId: string }) {
  const ingredient = useIngredient(ingredientId);
  const set = useSetDefaultPortion();
  const selectId = useId();
  const hintId = `${selectId}-hint`;

  const data = ingredient.data;
  const portions = data?.nutrition?.portions ?? [];
  if (data === undefined || data.nutrition?.fdcId == null || portions.length === 0) return null;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={selectId}>
        A plain count means
      </label>
      <select
        id={selectId}
        className={styles.select}
        value={data.defaultPortion ?? AUTOMATIC}
        aria-describedby={hintId}
        disabled={set.isPending}
        onChange={(event) => {
          const next = event.target.value === AUTOMATIC ? null : event.target.value;
          set.mutate(
            { ingredientId, defaultPortion: next },
            {
              onSuccess: () =>
                toast.show({ message: next === null ? `${data.name}: plain counts use the automatic portion` : `${data.name}: a plain count is one ${next}` }),
              onError: (error) => toast.error(errorMessage(error)),
            },
          );
        }}
      >
        <option value={AUTOMATIC}>Automatic</option>
        {portions.map((portion) => (
          <option key={portion.label} value={portion.label}>
            {portion.label} ({grams(portion.grams)})
          </option>
        ))}
      </select>
      <p id={hintId} className={styles.hint}>
        A line with no unit, such as “2” eggs, uses this portion.
      </p>
    </div>
  );
}
