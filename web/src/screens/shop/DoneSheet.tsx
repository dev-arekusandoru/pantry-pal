import { useState } from "react";
import { Button, Emoji, Sheet, ingredientEmoji } from "@/ui";
import type { ShoppingItem } from "./cart";
import { formatAmount, parseQty, qtyToInput, unitLabel } from "./format";
import styles from "./Shop.module.css";
import { useCompleteList, type ReceivedQty } from "./queries";

export interface DoneSheetProps {
  open: boolean;
  onClose: () => void;
  listId: string;
  /** Checked items, in cart order. */
  checked: readonly ShoppingItem[];
  /** Items left unchecked. */
  remaining: number;
  /** The server confirmed the trip. */
  onCompleted: () => void;
}

/** What was bought: the amount to confirm, defaulting to what the list planned. */
function boughtQty(item: ShoppingItem): number | null {
  return item.actualQty ?? item.qty;
}

function isBad(text: string | undefined): boolean {
  return text !== undefined && text.trim() !== "" && parseQty(text) === null;
}

export function DoneSheet({ open, onClose, listId, checked, remaining, onCompleted }: DoneSheetProps) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const complete = useCompleteList(listId, onCompleted);

  const invalid = checked.some((i) => isBad(edits[i.id]));

  function confirm() {
    const received: ReceivedQty[] = [];
    for (const item of checked) {
      const text = edits[item.id]?.trim();
      if (!text) continue;
      const qty = parseQty(text);
      if (qty !== null && qty !== boughtQty(item)) received.push({ itemId: item.id, qty });
    }
    complete.mutate(received);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Done shopping"
      footer={
        <>
          <Button onClick={onClose}>Keep shopping</Button>
          <Button variant="primary" onClick={confirm} loading={complete.isPending} disabled={invalid || checked.length === 0}>
            Add to pantry
          </Button>
        </>
      }
    >
      {checked.length === 0 ? (
        <p className={styles.sheetNote}>Nothing is checked off yet. Tick things as they go in the cart, then come back here.</p>
      ) : (
        <>
          <p className={styles.sheetNote}>
            Check what you actually got. {checked.length === 1 ? "It goes" : "They go"} into your pantry.
          </p>
          <ul className={styles.review}>
            {checked.map((item) => (
              <ReviewRow
                key={item.id}
                item={item}
                text={edits[item.id]}
                onChange={(text) => setEdits((prev) => ({ ...prev, [item.id]: text }))}
              />
            ))}
          </ul>
        </>
      )}
      {remaining > 0 && (
        <p className={styles.sheetFoot}>
          {remaining} {remaining === 1 ? "item isn't" : "items aren't"} checked. {remaining === 1 ? "It stays" : "They stay"} on this
          list and won't carry over to the next one.
        </p>
      )}
    </Sheet>
  );
}

function ReviewRow({ item, text, onChange }: { item: ShoppingItem; text: string | undefined; onChange: (text: string) => void }) {
  const planned = boughtQty(item);
  const shown = text === undefined ? planned : parseQty(text);
  const unit = planned === null ? "" : unitLabel(item.actualUnit ?? item.unit, shown ?? planned);
  return (
    <li className={styles.reviewRow}>
      <span className={styles.itemEmoji} aria-hidden="true">
        <Emoji code={ingredientEmoji(item.name)} size={26} />
      </span>
      <span className={styles.reviewName}>
        {item.name}
        {item.ingredientId === null && <small>Not tracked in the pantry</small>}
      </span>
      {item.ingredientId === null ? (
        <span className={styles.qtyUnit}>Skipped</span>
      ) : (
        <span className={styles.qtyEdit}>
          <input
            className={styles.qtyInput}
            inputMode="decimal"
            autoComplete="off"
            aria-label={`Quantity of ${item.name}`}
            aria-invalid={isBad(text) || undefined}
            placeholder={planned === null ? "some" : formatAmount(planned, null)}
            value={text ?? (planned === null ? "" : qtyToInput(planned))}
            onChange={(e) => onChange(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
          {unit !== "" && <span className={styles.qtyUnit}>{unit}</span>}
        </span>
      )}
    </li>
  );
}
