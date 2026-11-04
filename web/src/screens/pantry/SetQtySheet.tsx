import { useState, type FormEvent } from "react";
import { Button, Sheet } from "@/ui";
import { parseQty, qtyToInput, unitLabel } from "../shop/format";
import styles from "./Pantry.module.css";
import type { PantryItem } from "./stock";

export interface SetQtySheetProps {
  /** The item being edited; null closes the sheet. */
  item: PantryItem | null;
  onClose: () => void;
  onSave: (item: PantryItem, qty: number) => void;
}

export function SetQtySheet({ item, onClose, onSave }: SetQtySheetProps) {
  return (
    <Sheet open={item !== null} onClose={onClose} title={item ? `${item.ingredient.name}: how much?` : "Set amount"} footer={null}>
      {item && <Form key={item.id} item={item} onClose={onClose} onSave={onSave} />}
    </Sheet>
  );
}

function Form({ item, onClose, onSave }: { item: PantryItem; onClose: () => void; onSave: (item: PantryItem, qty: number) => void }) {
  const [text, setText] = useState(item.qty === null ? "" : qtyToInput(item.qty));
  const qty = parseQty(text);
  const unit = unitLabel(item.unit, qty);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (qty === null) return;
    onSave(item, qty);
    onClose();
  }

  return (
    <form className={styles.setForm} onSubmit={submit}>
      <label className={styles.setField}>
        <span className="sr-only">Amount</span>
        <input
          className={styles.input}
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={text}
          aria-invalid={text.trim() !== "" && qty === null ? true : undefined}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
        {unit !== "" && <span className={styles.setUnit}>{unit}</span>}
      </label>
      <div className={styles.setActions}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={qty === null}>
          Save
        </Button>
      </div>
    </form>
  );
}
