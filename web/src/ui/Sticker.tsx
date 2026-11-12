import type { CSSProperties } from "react";
import styles from "./Sticker.module.css";
import { cx } from "./cx";
import { Emoji } from "./Emoji";
import type { EmojiCode } from "./foodIcons";

export interface StickerProps {
  /** Icon name from `foodIcons.ts`, or an http(s) image URL. */
  emoji: EmojiCode;
  /** Icon name to show if a custom URL fails to load. */
  fallback?: EmojiCode;
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

/** Decorative food-icon sticker. Always `aria-hidden`; put the meaning in nearby text. */
export function Sticker({ emoji, fallback, shape = "disc", tone = "peach", size = 48, tilt = 0, className }: StickerProps) {
  const style = { "--size": `${size}px`, "--tilt": `${tilt}deg` } as CSSProperties;
  return (
    <span aria-hidden="true" className={cx(styles.sticker, styles[shape], shape === "disc" && styles[tone], className)} style={style}>
      <Emoji code={emoji} fallback={fallback} size={shape === "die-cut" ? size : Math.round(size * 0.6)} />
    </span>
  );
}
