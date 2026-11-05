import { ToggleGroup } from "radix-ui";
import { cx } from "@/ui";
import styles from "./Pantry.module.css";

export interface ChoiceChipOption<T extends string> {
  value: T;
  label: string;
}

export interface ChoiceChipsProps<T extends string> {
  options: ReadonlyArray<ChoiceChipOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Filter by location". */
  label: string;
  className?: string;
}

/**
 * Row of filter chips; exactly one is selected. Radix ToggleGroup adds arrow-key
 * navigation and a real pressed state while keeping the segmented-control look.
 */
export function ChoiceChips<T extends string>({ options, value, onChange, label, className }: ChoiceChipsProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      aria-label={label}
      className={cx(styles.chips, className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} className={styles.chip}>
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
