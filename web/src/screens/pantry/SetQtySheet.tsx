import { useId, useState, type FormEvent } from "react";
import { AlertDialog, Label } from "radix-ui";
import { Button, Icon, Sheet } from "@/ui";
import { parseQty, qtyToInput, unitLabel } from "../shop/format";
import styles from "./Pantry.module.css";
import { LOCATION_LABEL, type PantryItem } from "./stock";

export interface PantryChanges {
  qty: number;
  expiresOn: string | null;
  shelfLifeDays: number | null;
}

export interface SetQtySheetProps {
  /** The item being edited; null closes the sheet. */
  item: PantryItem | null;
  onClose: () => void;
  onSave: (item: PantryItem, changes: PantryChanges) => void;
  /** Remove the row from the pantry entirely; the caller confirms with an Undo toast. */
  onRemove: (item: PantryItem) => void;
}

export function SetQtySheet({ item, onClose, onSave, onRemove }: SetQtySheetProps) {
  return (
    <Sheet
      open={item !== null}
      onClose={onClose}
      title={item ? `${item.ingredient.name}: how much?` : "Set amount"}
      footer={null}
    >
      {item && <Form key={item.id} item={item} onClose={onClose} onSave={onSave} onRemove={onRemove} />}
    </Sheet>
  );
}

interface FormProps {
  item: PantryItem;
  onClose: () => void;
  onSave: (item: PantryItem, changes: PantryChanges) => void;
  onRemove: (item: PantryItem) => void;
}

function Form({ item, onClose, onSave, onRemove }: FormProps) {
  const [text, setText] = useState(item.qty === null ? "" : qtyToInput(item.qty));
  const [expiresOn, setExpiresOn] = useState(item.expiresOn ?? "");
  const [shelfText, setShelfText] = useState(
    item.ingredient.shelfLifeDays === null ? "" : String(item.ingredient.shelfLifeDays),
  );
  const amountId = useId();
  const expiryId = useId();
  const shelfId = useId();
  const qty = parseQty(text);
  const unit = unitLabel(item.unit, qty);
  const name = item.ingredient.name;
  const shelfLifeDays = shelfText.trim() === "" ? null : Number(shelfText);
  const shelfBad = shelfLifeDays !== null && (!Number.isInteger(shelfLifeDays) || shelfLifeDays < 0);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (qty === null || shelfBad) return;
    onSave(item, { qty, expiresOn: expiresOn === "" ? null : expiresOn, shelfLifeDays });
    onClose();
  }

  return (
    <form className={styles.setForm} onSubmit={submit}>
      <div className={styles.setField}>
        <Label.Root className="sr-only" htmlFor={amountId}>
          Amount
        </Label.Root>
        <input
          id={amountId}
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
      </div>
      <div className={styles.field}>
        <Label.Root className={styles.fieldLabel} htmlFor={expiryId}>
          Best before
        </Label.Root>
        <input
          id={expiryId}
          type="date"
          className={styles.input}
          value={expiresOn}
          onChange={(e) => setExpiresOn(e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <Label.Root className={styles.fieldLabel} htmlFor={shelfId}>
          Shelf life in days
        </Label.Root>
        <input
          id={shelfId}
          className={styles.input}
          inputMode="numeric"
          autoComplete="off"
          placeholder="No shelf life"
          value={shelfText}
          aria-invalid={shelfBad || undefined}
          onChange={(e) => setShelfText(e.target.value)}
        />
      </div>
      <div className={styles.setActions}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={qty === null || shelfBad}>
          Save
        </Button>
      </div>
      <AlertDialog.Root>
        <AlertDialog.Trigger asChild>
          <Button variant="secondary" icon={<Icon name="trash" />} className={styles.removeTrigger}>
            Remove from pantry
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className={styles.alertOverlay} />
          <AlertDialog.Content className={styles.alertContent}>
            <AlertDialog.Title className={styles.alertTitle}>Remove {name}?</AlertDialog.Title>
            <AlertDialog.Description className={styles.hint}>
              {name} leaves the {LOCATION_LABEL[item.location].toLowerCase()} shelf along with its recorded amount. Undo
              from the toast puts it straight back.
            </AlertDialog.Description>
            <div className={styles.setActions}>
              <AlertDialog.Cancel asChild>
                <Button>Keep it</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  variant="primary"
                  icon={<Icon name="trash" />}
                  onClick={() => {
                    onRemove(item);
                    onClose();
                  }}
                >
                  Remove
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </form>
  );
}
