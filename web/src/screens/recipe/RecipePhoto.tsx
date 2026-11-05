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

/**
 * Photos already shown this session. A remount (back from a recipe, tab switch)
 * renders them at full opacity immediately, so a route View Transition never
 * snapshots a half-faded photo.
 */
const shownImages = new Set<string>();

/**
 * Recipe photo that falls back to a sticker icon when missing or broken.
 * Decorative (the title sits next to it). The sticker stays underneath the
 * photo, so the frame is never blank while the image decodes; the image then
 * fades in over it instead of snapping.
 */
export function RecipePhoto({ imageUrl, mealTypes, className, priority }: RecipePhotoProps) {
  // Remember which URL failed/loaded, so a changed URL gets another try.
  const [failed, setFailed] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const showImage = imageUrl !== null && imageUrl !== "" && failed !== imageUrl;
  const loaded = loadedSrc === imageUrl || (imageUrl !== null && shownImages.has(imageUrl));
  function markLoaded(src: string) {
    shownImages.add(src);
    setLoadedSrc(src);
  }
  return (
    <div className={cx(styles.photo, className)}>
      <Emoji code={recipeEmoji(mealTypes)} size="clamp(44px, 12vw, 76px)" className={styles.plate} />
      {showImage && (
        <img
          className={cx(styles.photoImg, loaded && styles.loaded)}
          src={imageUrl}
          alt=""
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          // Cached images can be complete before React attaches onLoad.
          ref={(node) => {
            if (!node || !node.complete) return;
            if (node.naturalWidth > 0) markLoaded(imageUrl);
            else setFailed(imageUrl);
          }}
          onLoad={() => markLoaded(imageUrl)}
          onError={() => setFailed(imageUrl)}
        />
      )}
    </div>
  );
}
