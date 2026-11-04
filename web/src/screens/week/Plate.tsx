import { useState } from "react";
import { cx } from "@/ui";
import styles from "./Plate.module.css";

interface PlateProps {
  imageUrl: string | null | undefined;
  /** Emoji shown when there is no photo or it fails to load. */
  emoji: string;
  className?: string;
}

/** Recipe photo on a soft colored plate; falls back to a sticker emoji. */
export function Plate({ imageUrl, emoji, className }: PlateProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = imageUrl && failed !== imageUrl;
  return (
    <div className={cx(styles.plate, className)} aria-hidden="true">
      <span className={styles.emoji}>{emoji}</span>
      {showImage && <img src={imageUrl} alt="" loading="lazy" onError={() => setFailed(imageUrl)} />}
    </div>
  );
}
