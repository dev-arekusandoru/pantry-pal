import type { ElementType, HTMLAttributes } from "react";
import styles from "./Card.module.css";
import { cx } from "./cx";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Element to render. Default `div`. */
  as?: ElementType;
  radius?: "md" | "lg" | "xl";
  /** Default padding (16px). Pass `false` for edge-to-edge content like photos. */
  padded?: boolean;
}

/** White surface with a soft shadow. */
export function Card({ as: Tag = "div", radius = "lg", padded = true, className, ...rest }: CardProps) {
  return <Tag className={cx(styles.card, styles[radius], padded && styles.padded, className)} {...rest} />;
}
