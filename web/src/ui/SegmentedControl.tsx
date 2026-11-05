import type { ReactNode } from "react";
import { ToggleGroup } from "radix-ui";
import styles from "./SegmentedControl.module.css";
import { cx } from "./cx";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Optional decorative icon before the label. */
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Filter by location". */
  label: string;
  className?: string;
}

/**
 * Row of filter chips; exactly one is selected (Radix single ToggleGroup, so it
 * is a radiogroup for assistive tech and arrow keys move between chips).
 * Scrolls horizontally when it overflows.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, label, className }: SegmentedControlProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // A single ToggleGroup reports "" when the active chip is clicked again; keep a chip always selected.
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      aria-label={label}
      className={cx(styles.root, className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} className={styles.seg}>
          {o.icon}
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
