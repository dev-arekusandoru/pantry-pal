import type { InputHTMLAttributes } from "react";
import { Label } from "radix-ui";
import styles from "./SearchInput.module.css";
import { cx } from "./cx";
import { Icon } from "./icons";

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name; also the default placeholder. */
  label: string;
}

export function SearchInput({ value, onChange, label, placeholder, className, ...rest }: SearchInputProps) {
  return (
    <Label.Root className={cx(styles.root, className)}>
      <Icon name="search" />
      <input
        type="search"
        inputMode="search"
        autoComplete="off"
        enterKeyHint="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </Label.Root>
  );
}
