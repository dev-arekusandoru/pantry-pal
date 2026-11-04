import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./IconButton.module.css";
import { cx } from "./cx";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name (required: there is no visible text). */
  label: string;
  icon: ReactNode;
  /** `plain` drops the card background, e.g. for use on tinted blocks. */
  variant?: "raised" | "plain";
}

export function IconButton({ label, icon, variant = "raised", className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(styles.btn, variant === "plain" && styles.plain, className)}
      {...rest}
    >
      {icon}
    </button>
  );
}
