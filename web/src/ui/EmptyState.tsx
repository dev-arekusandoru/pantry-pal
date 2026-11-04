import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";
import { cx } from "./cx";

export interface EmptyStateProps {
  /** Big sticker emoji. */
  emoji: string;
  title: string;
  /** Supporting sentence(s). */
  children?: ReactNode;
  /** Usually a primary Button. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ emoji, title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cx(styles.root, className)}>
      <p className={styles.emoji} aria-hidden="true">
        {emoji}
      </p>
      <h2 className={styles.title}>{title}</h2>
      {children && <p className={styles.text}>{children}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
