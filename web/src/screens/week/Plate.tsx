import { useState } from "react";
import { Emoji, cx, type EmojiCode } from "@/ui";
import styles from "./Plate.module.css";

interface PlateProps {
  imageUrl: string | null | undefined;
  /** OpenMoji code shown when there is no photo or it fails to load. */
  emoji: EmojiCode;
  className?: string;
}

/** Recipe photo on a soft colored plate; falls back to a sticker icon. */
export function Plate({ imageUrl, emoji, className }: PlateProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = imageUrl && failed !== imageUrl;
  return (
    <div className={cx(styles.plate, className)} aria-hidden="true">
      <Emoji code={emoji} size="clamp(44px, 12vw, 72px)" className={styles.emoji} />
      {showImage && <img className={styles.photo} src={imageUrl} alt="" loading="lazy" onError={() => setFailed(imageUrl)} />}
    </div>
  );
}
