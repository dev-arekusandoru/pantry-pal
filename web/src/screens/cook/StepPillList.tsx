import { Sticker, ingredientEmoji } from "@/ui";
import type { StepPill } from "./stepPills";
import styles from "./CookScreen.module.css";

/** Ingredients a step uses, shown under its text in the solo view and in crew panels. */
export function StepPills({ pills }: { pills: readonly StepPill[] }) {
  if (pills.length === 0) return null;
  return (
    <ul className={styles.stepIngs} aria-label="Ingredients for this step">
      {pills.map((pill) => (
        <li key={pill.id}>
          <span className={styles.ingChip}>
            <Sticker emoji={ingredientEmoji(pill.name, pill.imageUrl)} fallback={ingredientEmoji(pill.name)} tone="butter" size={32} />
            <span>
              {pill.amount && <b>{pill.amount} </b>}
              {pill.name}
              {pill.prepNote && <small>, {pill.prepNote}</small>}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
