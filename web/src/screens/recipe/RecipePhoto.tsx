import { useState } from "react";
import { Emoji, cx } from "@/ui";
import { recipeEmoji, type MealType } from "./lib";
import styles from "./RecipePhoto.module.css";

export interface RecipePhotoProps {
  imageUrl: string | null;
  mealTypes: ReadonlyArray<MealType>;
  className?: string;
  /** Eager loading for the above-the-fold hero. */
  priority?: boolean;
}

/** Recipe photo that falls back to a sticker icon when missing or broken. Decorative (the title sits next to it). */
export function RecipePhoto({ imageUrl, mealTypes, className, priority }: RecipePhotoProps) {
  // Remember which URL failed, so a changed URL gets another try.
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = imageUrl !== null && imageUrl !== "" && failed !== imageUrl;
  return (
    <div className={cx(styles.photo, className)}>
      {showImage ? (
        <img
          className={styles.photoImg}
          src={imageUrl}
          alt=""
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(imageUrl)}
        />
      ) : (
        <Emoji code={recipeEmoji(mealTypes)} size="clamp(44px, 12vw, 76px)" className={styles.plate} />
      )}
    </div>
  );
}
