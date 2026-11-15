import { useState, type CSSProperties } from "react";
import { Emoji, Icon } from "@/ui";
import { monthDay, weekdayName } from "../../../dates";
import { MEAL_LABEL, type RecipeSummary } from "../../../model";
import type { DraftBatch, DraftEat, DraftNote } from "../../draft";
import { noteIcon, recipeIcon, servingsText } from "../../model";
import styles from "./mobile.module.css";

/** Recipe photo with the desktop's food-icon badge on its corner; the bare icon when there is no photo. */
function Pic({ recipe, title, size }: { recipe: RecipeSummary | undefined; title: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const icon = recipeIcon(title);
  const badge = Math.max(16, Math.round(size * 0.26));
  if (!recipe?.imageUrl || failed) return <Emoji code={icon} size={Math.round(size * 0.7)} />;
  return (
    <span className={styles.pic} style={{ "--pic": `${size}px`, "--badge": `${badge}px` } as CSSProperties} aria-hidden="true">
      <img src={recipe.imageUrl} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      <span className={styles.picBadge}>
        <Emoji code={icon} size={Math.round(badge * 0.8)} />
      </span>
    </span>
  );
}

export function DishCard({ batch, eat, recipe, onOpen, onRemove }: {
  batch: DraftBatch;
  eat: DraftEat;
  recipe: RecipeSummary | undefined;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const from = batch.cookDate === eat.date ? "cook day" : `from ${weekdayName(batch.cookDate, "short")}`;
  return (
    <div className={styles.dish} data-hue={batch.hue}>
      <button
        type="button"
        className={styles.dishMain}
        aria-label={`${batch.title}, ${from}, ${servingsText(batch.servings)}. Edit servings and cook day`}
        onClick={onOpen}
      >
        <Pic recipe={recipe} title={batch.title} size={76} />
        <span className={styles.dishText}>
          <span className={styles.dishTitle}>{batch.title}</span>
          <span className={styles.dishMeta}>{servingsText(batch.servings)}</span>
        </span>
      </button>
      <button
        type="button"
        className={styles.dishX}
        aria-label={`Remove ${batch.title} from ${weekdayName(eat.date)} ${MEAL_LABEL[eat.mealType]}`}
        onClick={onRemove}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export function NoteCard({ note, onRemove }: { note: DraftNote; onRemove: () => void }) {
  return (
    <div className={styles.dish} data-kind="note">
      <span className={styles.dishMain}>
        <Emoji code={noteIcon(note)} size={42} />
        <span className={styles.dishText}>
          <span className={styles.dishTitle}>{note.label}</span>
        </span>
      </span>
      <button
        type="button"
        className={styles.dishX}
        aria-label={`Remove ${note.label} from ${weekdayName(note.date)} ${MEAL_LABEL[note.mealType]} (${note.kind === "skip" ? "skipping" : "not cooking"})`}
        onClick={onRemove}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

/** A cook tonight: one small chip in the day's horizontally scrolling strip. */
export function CookCard({ batch, recipe, onOpen }: { batch: DraftBatch; recipe: RecipeSummary | undefined; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={styles.cookCard}
      data-hue={batch.hue}
      aria-label={`Cook ${batch.title} on ${weekdayName(batch.cookDate)} ${monthDay(batch.cookDate)}, ${servingsText(batch.servings)}. Edit`}
      onClick={onOpen}
    >
      <Pic recipe={recipe} title={batch.title} size={30} />
      <span className={styles.cookText}>
        <span className={styles.cookTitle}>{batch.title}</span>
        <span className={styles.cookSrv}>{servingsText(batch.servings)}</span>
      </span>
    </button>
  );
}
