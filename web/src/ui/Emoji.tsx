import type { CSSProperties } from "react";
import { emojiSrc, type EmojiCode } from "./emoji";
import { cx } from "./cx";
import styles from "./Emoji.module.css";

export interface EmojiProps {
  /** OpenMoji hexcode, e.g. `"1F969"`. */
  code: EmojiCode;
  /** Square size (number = px, strings such as `"100%"` or a `clamp()` pass through). Default 24. */
  size?: number | string;
  /** Accessible text. Omit (the norm) for decorative icons next to a visible label. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * A single OpenMoji sticker icon. Decorative by default (`alt=""`); the meaning
 * belongs in nearby text. Width and height are set inline so the image reserves
 * its space before the SVG loads.
 */
export function Emoji({ code, size = 24, label, className, style }: EmojiProps) {
  const s = typeof size === "number" ? `${size}px` : size;
  return (
    <img
      src={emojiSrc(code)}
      alt={label ?? ""}
      aria-hidden={label === undefined ? true : undefined}
      width={typeof size === "number" ? size : undefined}
      height={typeof size === "number" ? size : undefined}
      draggable={false}
      decoding="async"
      className={cx(styles.emoji, className)}
      style={{ width: s, height: s, ...style }}
    />
  );
}
