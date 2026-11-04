import type { CSSProperties } from "react";
import styles from "./Skeleton.module.css";
import { cx } from "./cx";

export interface SkeletonProps {
  /** CSS width (number = px). Default 100%. */
  width?: number | string;
  /** CSS height (number = px). Default 1em. */
  height?: number | string;
  /** CSS radius (number = px). Default 12px; use 999 for pills/circles. */
  radius?: number | string;
  className?: string;
}

/** Shimmering placeholder block. Decorative; wrap the loading region in `aria-busy`. */
export function Skeleton({ width = "100%", height = "1em", radius = 12, className }: SkeletonProps) {
  const style: CSSProperties = { width, height, borderRadius: radius };
  return <span aria-hidden="true" className={cx(styles.skeleton, className)} style={style} />;
}
