import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Toast } from "radix-ui";
import styles from "./Toast.module.css";
import { cx } from "./cx";

export interface ToastInput {
  message: string;
  /** `error` is announced assertively. Default `default`. */
  tone?: "default" | "error";
  /** One-tap action, e.g. Undo. Dismisses the toast after it runs. */
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss delay. Default 4000ms (7000ms with an action). */
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
  /** False while the exit animation runs; the item is removed once it settles. */
  open: boolean;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const MAX_VISIBLE = 3;
/** Matches the closed-state animation (`--dur-exit` plus a small grace period). */
const EXIT_MS = 220;
const exitTimers = new Map<number, number>();

function emit(next: ToastItem[]) {
  items = next;
  for (const l of listeners) l();
}

function clearExitTimer(id: number) {
  const timer = exitTimers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    exitTimers.delete(id);
  }
}

function remove(id: number) {
  clearExitTimer(id);
  emit(items.filter((i) => i.id !== id));
}

function dismiss(id: number) {
  const item = items.find((i) => i.id === id);
  if (!item || !item.open) return;
  // Let the toast animate out (Radix keeps it mounted via Presence) before unmounting it.
  emit(items.map((i) => (i.id === id ? { ...i, open: false } : i)));
  clearExitTimer(id);
  exitTimers.set(
    id,
    window.setTimeout(() => remove(id), EXIT_MS),
  );
}

/**
 * Global toast API, callable from anywhere (mutation callbacks included).
 * Needs `<ToastHost />` mounted once; the app shell does that.
 */
export const toast = {
  show(input: ToastInput): number {
    const id = nextId++;
    const list = [...items.filter((i) => i.open), { ...input, id, open: true }].slice(-MAX_VISIBLE);
    for (const old of items) {
      if (!list.includes(old)) clearExitTimer(old.id);
    }
    emit(list);
    return id;
  },
  error(message: string): number {
    return toast.show({ message, tone: "error", durationMs: 6000 });
  },
  dismiss,
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function ToastHost() {
  const list = useSyncExternalStore(
    subscribe,
    () => items,
    () => items,
  );

  return createPortal(
    <Toast.Provider label="Notifications" swipeDirection="right">
      {list.map((t) => (
        <Toast.Root
          key={t.id}
          type={t.tone === "error" ? "foreground" : "background"}
          duration={t.durationMs ?? (t.action ? 7000 : 4000)}
          open={t.open}
          className={cx(styles.toast, t.tone === "error" && styles.error)}
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
        >
          <span>{t.message}</span>
          {t.action && (
            <Toast.Action altText={t.action.label} className={styles.action} onClick={t.action.onClick}>
              {t.action.label}
            </Toast.Action>
          )}
        </Toast.Root>
      ))}
      <Toast.Viewport className={styles.host} label="Notifications" />
    </Toast.Provider>,
    document.body,
  );
}
