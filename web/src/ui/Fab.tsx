import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Fab.module.css";
import { cx } from "./cx";
import { Icon } from "./icons";

export interface FabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  /** Accessible name; also the visible text when `showLabel` is set. */
  label: string;
  /** Defaults to a plus. */
  icon?: ReactNode;
  /** Extended FAB: show the label beside the icon. */
  showLabel?: boolean;
}

/**
 * The primary create/add action, floating above the bottom nav on phones and at
 * the bottom-right of the content column on wide screens. The shell's nav
 * geometry and content padding drive its offset through CSS variables.
 */
export function Fab({ label, icon, showLabel = false, className, type = "button", ...rest }: FabProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx(styles.fab, showLabel && styles.extended, className)}
      {...rest}
    >
      {icon ?? <Icon name="plus" />}
      {showLabel && <span className={styles.label}>{label}</span>}
    </button>
  );
}
