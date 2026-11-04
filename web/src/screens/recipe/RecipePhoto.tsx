import { useState } from "react";
import { cx } from "@/ui";
import { recipeEmoji, type MealType } from "./lib";
import styles from "./RecipePhoto.module.css";

export interface RecipePhotoProps {
  imageUrl: string | null;
  mealTypes: ReadonlyArray<MealType>;
  className?: string;
  /** Eager loading for the above-the-fold hero. */
  priority?: boolean;
}

/** Recipe photo that falls back to an emoji plate when missing or broken. Decorative (the title sits next to it). */
export function RecipePhoto({ imageUrl, mealTypes, className, priority }: RecipePhotoProps) {
  // Remember which URL failed, so a changed URL gets another try.
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = imageUrl !== null && imageUrl !== "" && failed !== imageUrl;
  return (
    <div className={cx(styles.photo, className)}>
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(imageUrl)}
        />
      ) : (
        <span className={styles.plate} aria-hidden="true">
          {recipeEmoji(mealTypes)}
        </span>
      )}
    </div>
  );
}
