import { useEffect, useState, type FormEvent } from "react";
import { Button, Icon, Sheet } from "@/ui";
import { parseQty, qtyToInput, unitLabel } from "../shop/format";
import styles from "./Pantry.module.css";
import { LOCATION_LABEL, type PantryItem } from "./stock";

export interface SetQtySheetProps {
  /** The item being edited; null closes the sheet. */
  item: PantryItem | null;
  onClose: () => void;
  onSave: (item: PantryItem, qty: number) => void;
  /** Remove the row from the pantry entirely; the caller confirms with an Undo toast. */
  onRemove: (item: PantryItem) => void;
}

export function SetQtySheet({ item, onClose, onSave, onRemove }: SetQtySheetProps) {
  const [confirming, setConfirming] = useState(false);
  // A closed sheet (or a different item) starts from the amount form again.
  useEffect(() => {
    setConfirming(false);
  }, [item?.id]);

  return (
    <Sheet
      open={item !== null}
      onClose={onClose}
      title={
        item
          ? confirming
            ? `Remove ${item.ingredient.name}?`
            : `${item.ingredient.name}: how much?`
          : "Set amount"
      }
      footer={null}
    >
      {item && (
        <Form
          key={item.id}
          item={item}
          confirming={confirming}
          setConfirming={setConfirming}
          onClose={onClose}
          onSave={onSave}
          onRemove={onRemove}
        />
      )}
    </Sheet>
  );
}

interface FormProps {
  item: PantryItem;
  confirming: boolean;
  setConfirming: (confirming: boolean) => void;
  onClose: () => void;
  onSave: (item: PantryItem, qty: number) => void;
  onRemove: (item: PantryItem) => void;
}

function Form({ item, confirming, setConfirming, onClose, onSave, onRemove }: FormProps) {
  const [text, setText] = useState(item.qty === null ? "" : qtyToInput(item.qty));
  const qty = parseQty(text);
  const unit = unitLabel(item.unit, qty);
  const name = item.ingredient.name;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (qty === null) return;
    onSave(item, qty);
    onClose();
  }

  if (confirming) {
    return (
      <div className={styles.setForm}>
        <p className={styles.hint}>
          {name} leaves the {LOCATION_LABEL[item.location].toLowerCase()} shelf along with its recorded amount. Undo from the
          toast puts it straight back.
        </p>
        <div className={styles.setActions}>
          <Button onClick={() => setConfirming(false)}>Keep it</Button>
          <Button variant="primary" icon={<Icon name="trash" />} onClick={() => { onRemove(item); onClose(); }}>
            Remove
          </Button>
        </div>
      </div>
    );
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
      <Button
        variant="secondary"
        icon={<Icon name="trash" />}
        className={styles.removeTrigger}
        onClick={() => setConfirming(true)}
      >
        Remove from pantry
      </Button>
    </form>
  );
}
