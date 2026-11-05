import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Checkbox as RadixCheckbox, Label } from "radix-ui";
import styles from "./Checkbox.module.css";
import { cx } from "./cx";
import { Icon } from "./icons";

export interface CheckboxProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "children" | "type"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label. Omit and pass `aria-label` for a box-only checkbox (e.g. inside a row). */
  children?: ReactNode;
}

/**
 * Chunky checkbox on a Radix Checkbox (a `role="checkbox"` button), labelled
 * through Radix Label so clicking the text toggles it too.
 */
export function Checkbox({ checked, onChange, children, className, id, ...rest }: CheckboxProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  return (
    <Label.Root htmlFor={controlId} className={cx(styles.root, className)}>
      <RadixCheckbox.Root
        id={controlId}
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
        className={styles.box}
        {...rest}
      >
        <RadixCheckbox.Indicator className={styles.check} forceMount>
          <Icon name="check" />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      {children !== undefined && <span className={styles.label}>{children}</span>}
    </Label.Root>
  );
}
