import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
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
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const MAX_VISIBLE = 3;

function emit(next: ToastItem[]) {
  items = next;
  for (const l of listeners) l();
}

function dismiss(id: number) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  emit(items.filter((i) => i.id !== id));
}

/**
 * Global toast API, callable from anywhere (mutation callbacks included).
 * Needs `<ToastHost />` mounted once; the app shell does that.
 */
export const toast = {
  show(input: ToastInput): number {
    const id = nextId++;
    emit([...items, { ...input, id }].slice(-MAX_VISIBLE));
    timers.set(
      id,
      setTimeout(() => dismiss(id), input.durationMs ?? (input.action ? 7000 : 4000)),
    );
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

  // Drop timers for toasts evicted by the MAX_VISIBLE cap.
  useEffect(() => {
    const live = new Set(list.map((i) => i.id));
    for (const [id, t] of timers) {
      if (!live.has(id)) {
        clearTimeout(t);
        timers.delete(id);
      }
    }
  }, [list]);

  return createPortal(
    <div className={styles.host} role="region" aria-label="Notifications">
      {list.map((t) => (
        <div key={t.id} className={cx(styles.toast, t.tone === "error" && styles.error)} role={t.tone === "error" ? "alert" : "status"}>
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}
