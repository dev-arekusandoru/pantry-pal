import { useEffect, useState, type CSSProperties } from "react";
import { emojiSrc, type EmojiCode } from "./foodIcons";
import { cx } from "./cx";
import styles from "./Emoji.module.css";

export interface EmojiProps {
  /** Icon name from `foodIcons.ts`, or an http(s) image URL. */
  code: EmojiCode;
  /** Square size (number = px, strings such as `"100%"` or a `clamp()` pass through). Default 24. */
  size?: number | string;
  /** Accessible text. Omit (the norm) for decorative icons next to a visible label. */
  label?: string;
  /** Icon name to show if a custom URL fails to load. */
  fallback?: EmojiCode;
  /** Passed to the image; use `lazy` in long grids. */
  loading?: "lazy" | "eager";
  className?: string;
  style?: CSSProperties;
}

/**
 * A single food icon (PNG). Decorative by default (`alt=""`); the meaning
 * belongs in nearby text. Width and height are set inline so the image reserves
 * its space before the image loads.
 */
export function Emoji({ code, size = 24, label, fallback, loading, className, style }: EmojiProps) {
  const [failed, setFailed] = useState(false);
  // A new source gets a fresh chance to load.
  useEffect(() => setFailed(false), [code]);
  const s = typeof size === "number" ? `${size}px` : size;
  const src = failed && fallback ? emojiSrc(fallback) : emojiSrc(code);
  return (
    <img
      src={src}
      alt={label ?? ""}
      aria-hidden={label === undefined ? true : undefined}
      width={typeof size === "number" ? size : undefined}
      height={typeof size === "number" ? size : undefined}
      draggable={false}
      decoding="async"
      loading={loading}
      onError={failed || !fallback ? undefined : () => setFailed(true)}
      className={cx(styles.emoji, className)}
      style={{ width: s, height: s, ...style }}
    />
  );
}
