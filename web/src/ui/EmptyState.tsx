import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";
import { cx } from "./cx";
import { Emoji } from "./Emoji";
import type { EmojiCode } from "./emoji";

export interface EmptyStateProps {
  /** Big sticker icon (OpenMoji code). */
  emoji: EmojiCode;
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
      <Emoji code={emoji} size={54} className={styles.emoji} />
      <h2 className={styles.title}>{title}</h2>
      {children && <p className={styles.text}>{children}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
