import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import styles from "./Checkbox.module.css";
import { cx } from "./cx";
import { Icon } from "./icons";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "checked" | "children"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label. Omit and pass `aria-label` for a box-only checkbox (e.g. inside a row). */
  children?: ReactNode;
}

/** Chunky checkbox on a real `<input type="checkbox">`, so keyboard and screen readers just work. */
export function Checkbox({ checked, onChange, children, className, id, ...rest }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label className={cx(styles.root, className)} htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        className={styles.input}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        {...rest}
      />
      <span className={styles.box} aria-hidden="true">
        <Icon name="check" />
      </span>
      {children !== undefined && <span className={styles.label}>{children}</span>}
    </label>
  );
}
