import type { CSSProperties } from "react";
import styles from "./Sticker.module.css";
import { cx } from "./cx";
import { Emoji } from "./Emoji";
import type { EmojiCode } from "./emoji";

export interface StickerProps {
  /** OpenMoji code. */
  emoji: EmojiCode;
  /** `disc`: icon on a ringed circle (list rows). `die-cut`: bare icon with a white sticker edge. */
  shape?: "disc" | "die-cut";
  /** Ring color for `disc`. Default `peach`. */
  tone?: "peach" | "pistachio" | "blue" | "gum" | "butter" | "plain";
  /** Diameter in px. Default 48. */
  size?: number;
  /** Rotation in degrees. Default 0. */
  tilt?: number;
  className?: string;
}

/** Decorative OpenMoji sticker. Always `aria-hidden`; put the meaning in nearby text. */
export function Sticker({ emoji, shape = "disc", tone = "peach", size = 48, tilt = 0, className }: StickerProps) {
  const style = { "--size": `${size}px`, "--tilt": `${tilt}deg` } as CSSProperties;
  return (
    <span aria-hidden="true" className={cx(styles.sticker, styles[shape], shape === "disc" && styles[tone], className)} style={style}>
      <Emoji code={emoji} size={shape === "die-cut" ? size : Math.round(size * 0.6)} />
    </span>
  );
}
