import { RadioGroup } from "radix-ui";
import { Icon, Pill, Sheet } from "@/ui";
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
      <RadioGroup.Root
        className={styles.pickList}
        orientation="vertical"
        value={selectedId}
        onValueChange={onSelect}
        aria-label="Shopping lists"
      >
        {lists.map((l) => (
          <RadioGroup.Item key={l.id} value={l.id} type="button" className={styles.pickRow}>
            <span className={styles.pickBody}>
              <span className={styles.pickTitle}>{l.title}</span>
              <span className={styles.pickSub}>
                {l.status === "shopping" ? "Shopping now" : "Draft"} · made {madeOn(l.createdAt)}
              </span>
            </span>
            {l.stale && <Pill tone="butter">Plan changed</Pill>}
            {l.id === selectedId && <Icon name="check" />}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </Sheet>
  );
}
