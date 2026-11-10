import type { ReactNode } from "react";
import { Button } from "./Button";
import { Icon, type IconName } from "./icons";
import { Sheet } from "./Sheet";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** Question, e.g. "Delete this list?" */
  title: string;
  /** What the action does, including how to recover. */
  children: ReactNode;
  /** Label of the destructive action. */
  confirmLabel: string;
  onConfirm: () => void;
  /** Keep the dialog open and show the confirm button busy. */
  pending?: boolean;
  /** Opt out of a recovery path, e.g. "Keep the list". */
  cancelLabel?: string;
  icon?: IconName;
}

/**
 * The one destructive confirmation: a sheet with a secondary cancel and a solid
 * `danger` confirm. The caller closes it on success.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  onConfirm,
  pending,
  cancelLabel = "Cancel",
  icon = "trash",
}: ConfirmDialogProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>{cancelLabel}</Button>
          <Button
            variant="danger"
            icon={<Icon name={icon} />}
            loading={pending}
            onClick={(event) => {
              // Stay open while the request runs; the caller closes on success.
              event.preventDefault();
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className={styles.text}>{children}</p>
    </Sheet>
  );
}
