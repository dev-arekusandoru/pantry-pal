import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";
import { cx } from "./cx";

export interface PageHeaderProps {
  title: string;
  /** Line under the title, e.g. "Mon Nov 2 to Sun Nov 8". */
  sub?: ReactNode;
  /** Right-hand slot: a count badge or another compact control. Primary add actions belong in a Fab. */
  aside?: ReactNode;
  className?: string;
}

/**
 * The glazed header block: tab-colored, with the tab's die-cut sticker in the
 * corner. Colors and sticker come from the nearest `data-tab` (set by the shell).
 */
export function PageHeader({ title, sub, aside, className }: PageHeaderProps) {
  return (
    <header className={cx(styles.head, className)}>
      <div className={styles.text}>
        <h1>{title}</h1>
        {sub && <p className={styles.sub}>{sub}</p>}
      </div>
      {aside && <div className={styles.aside}>{aside}</div>}
    </header>
  );
}
