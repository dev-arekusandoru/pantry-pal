import type { CSSProperties } from "react";
import styles from "./Sticker.module.css";
import { cx } from "./cx";

export interface StickerProps {
  emoji: string;
  /** `disc`: emoji on a ringed circle (list rows). `die-cut`: bare emoji with a white sticker edge. */
  shape?: "disc" | "die-cut";
  /** Ring color for `disc`. Default `peach`. */
  tone?: "peach" | "pistachio" | "blue" | "gum" | "butter" | "plain";
  /** Diameter in px. Default 48. */
  size?: number;
  /** Rotation in degrees. Default 0. */
  tilt?: number;
  className?: string;
}

/** Decorative emoji sticker. Always `aria-hidden`; put the meaning in nearby text. */
export function Sticker({ emoji, shape = "disc", tone = "peach", size = 48, tilt = 0, className }: StickerProps) {
  const style = { "--size": `${size}px`, "--tilt": `${tilt}deg` } as CSSProperties;
  return (
    <span aria-hidden="true" className={cx(styles.sticker, styles[shape], shape === "disc" && styles[tone], className)} style={style}>
      {emoji}
    </span>
  );
}
