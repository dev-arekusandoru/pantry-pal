import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Pill.module.css";
import { cx } from "./cx";

export type PillTone = "neutral" | "tab" | "butter" | "pistachio" | "gum" | "blue" | "peach" | "tomato";

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  /** `tab` follows the current screen's color (`data-tab`). Default `neutral`. */
  tone?: PillTone;
  icon?: ReactNode;
}

/** Small rounded label: counts, statuses, "On hand". */
export function Pill({ tone = "neutral", icon, className, children, ...rest }: PillProps) {
  return (
    <span className={cx(styles.pill, styles[tone], className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}
