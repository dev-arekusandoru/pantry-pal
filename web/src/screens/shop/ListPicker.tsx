import { Icon, Pill, Sheet, cx } from "@/ui";
import type { ShoppingList } from "./cart";
import styles from "./Shop.module.css";

export interface ListPickerProps {
  open: boolean;
  onClose: () => void;
  /** Open (not done) lists only. */
  lists: readonly ShoppingList[];
  selectedId: string;
  onSelect: (id: string) => void;
}

function madeOn(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ListPicker({ open, onClose, lists, selectedId, onSelect }: ListPickerProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Switch list">
      <ul className={styles.pickList}>
        {lists.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              className={cx(styles.pickRow, l.id === selectedId && styles.pickOn)}
              aria-current={l.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(l.id)}
            >
              <span className={styles.pickBody}>
                <span className={styles.pickTitle}>{l.title}</span>
                <span className={styles.pickSub}>
                  {l.status === "shopping" ? "Shopping now" : "Draft"} · made {madeOn(l.createdAt)}
                </span>
              </span>
              {l.stale && <Pill tone="butter">Plan changed</Pill>}
              {l.id === selectedId && <Icon name="check" />}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
