import styles from "./Stepper.module.css";
import { cx } from "./cx";
import { Icon } from "./icons";

export interface StepperProps {
  /** What the stepper changes, for screen readers: "Servings" gives "Decrease servings". */
  label: string;
  /** Current value, already formatted. */
  value: string | number;
  /** Small unit text after the value, e.g. "lb". */
  unit?: string;
  onDecrement: () => void;
  onIncrement: () => void;
  disableDecrement?: boolean;
  disableIncrement?: boolean;
  /** Makes the value itself a button (e.g. to type an exact amount). `valueLabel` is its accessible name. */
  onValueClick?: () => void;
  valueLabel?: string;
  className?: string;
}

/** Pill with a minus button, the value, and a plus button. */
export function Stepper({
  label,
  value,
  unit,
  onDecrement,
  onIncrement,
  disableDecrement,
  disableIncrement,
  onValueClick,
  valueLabel,
  className,
}: StepperProps) {
  const lower = label.toLowerCase();
  const content = (
    <>
      <b>{value}</b>
      {unit && <small> {unit}</small>}
    </>
  );
  return (
    <div className={cx(styles.root, className)} role="group" aria-label={label}>
      <button type="button" className={styles.step} aria-label={`Decrease ${lower}`} onClick={onDecrement} disabled={disableDecrement}>
        <Icon name="minus" />
      </button>
      {onValueClick ? (
        <button type="button" className={cx(styles.value, styles.valueButton)} aria-label={valueLabel} onClick={onValueClick}>
          {content}
        </button>
      ) : (
        <span className={styles.value} aria-live="polite">
          {content}
        </span>
      )}
      <button type="button" className={styles.step} aria-label={`Increase ${lower}`} onClick={onIncrement} disabled={disableIncrement}>
        <Icon name="plus" />
      </button>
    </div>
  );
}
