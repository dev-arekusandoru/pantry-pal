import { useState } from "react";
import { probeServer } from "../api/connection";
import { errorMessage, isUnreachable } from "../api/errors";
import { Button } from "./Button";
import styles from "./ErrorState.module.css";
import { cx } from "./cx";
import { Icon } from "./icons";

export interface ErrorStateProps {
  /** The thrown value from a query/mutation. Network failures get the "can't reach" variant automatically. */
  error?: unknown;
  /** Force a variant. Default: derived from `error`. */
  variant?: "unreachable" | "generic";
  title?: string;
  /** Shows a retry button. For `unreachable` it first probes the server. */
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ error, variant, title, onRetry, className }: ErrorStateProps) {
  const unreachable = (variant ?? (isUnreachable(error) ? "unreachable" : "generic")) === "unreachable";
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      if (unreachable) await probeServer();
      onRetry?.();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className={cx(styles.root, className)} role="alert">
      <span className={styles.icon} aria-hidden="true">
        <Icon name={unreachable ? "offline" : "alert"} />
      </span>
      <h2 className={styles.title}>{title ?? (unreachable ? "Can't reach PantryPal" : "Something went wrong")}</h2>
      <p className={styles.text}>
        {unreachable
          ? "Check that PantryPal is running and that this device is on the same network, then try again."
          : error !== undefined
            ? errorMessage(error)
            : "Please try again."}
      </p>
      {(onRetry || unreachable) && (
        <Button variant="primary" icon={<Icon name="refresh" />} onClick={retry} loading={retrying}>
          Try again
        </Button>
      )}
    </div>
  );
}
