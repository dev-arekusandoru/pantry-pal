import { useId, useState, type FormEvent } from "react";
import { Label, Select } from "radix-ui";
import { Button, Icon, Sheet, cx } from "@/ui";
import { IngredientPicker } from "../ingredients/IngredientPicker";
import { ingredientErrorMessage, type IngredientPick } from "../ingredients/refs";
import { parseQty } from "../shop/format";
import styles from "./Pantry.module.css";
import { useAddStock } from "./queries";
import { type PantryItem } from "./stock";

/** Radix Select reserves the empty string for "no value", so the unit-less choice gets a sentinel. */
const NO_UNIT = "__none";

const UNITS: ReadonlyArray<readonly [string, string]> = [
  ["", "No unit"],
  ["lb", "lb"],
  ["oz", "oz"],
  ["g", "g"],
  ["kg", "kg"],
  ["cup", "cups"],
  ["tbsp", "tbsp"],
  ["tsp", "tsp"],
  ["ml", "ml"],
  ["l", "liters"],
  ["can", "cans"],
  ["jar", "jars"],
  ["bag", "bags"],
  ["bottle", "bottles"],
  ["box", "boxes"],
  ["package", "packages"],
  ["bunch", "bunches"],
  ["head", "heads"],
];

export interface AddSheetProps {
  open: boolean;
  onClose: () => void;
  /** Items already in the pantry, to avoid replacing an amount by accident. */
  existing: readonly PantryItem[];
  initialName?: string;
}

export function AddSheet(props: AddSheetProps) {
  // Mounted only while open, so every open starts with a blank form.
  return props.open ? <AddForm {...props} /> : null;
}

function AddForm({ onClose, existing, initialName = "" }: AddSheetProps) {
  const [pick, setPick] = useState<IngredientPick | null>(null);
  const [qtyText, setQtyText] = useState("");
  const [unit, setUnit] = useState("");
  const add = useAddStock();
  const qtyId = useId();
  const unitId = useId();

  const qty = parseQty(qtyText);
  const qtyBad = qtyText.trim() !== "" && (qty === null || qty <= 0);
  const duplicate = pick !== null && qtyText.trim() === "" && existing.some((i) => i.ingredient.id === pick.id);
  const canAdd = pick !== null && !qtyBad && !duplicate;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canAdd || pick === null) return;
    add.mutate(
      { ingredientId: pick.id, qty: qtyText.trim() === "" ? null : qty, unit: unit === "" ? null : unit },
      { onSuccess: onClose },
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Add to the pantry"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="pantry-add" variant="primary" disabled={!canAdd} loading={add.isPending}>
            Add
          </Button>
        </>
      }
    >
      <form id="pantry-add" className={styles.addForm} onSubmit={submit}>
        <IngredientPicker
          label="What is it?"
          value={pick}
          onChange={setPick}
          initialQuery={initialName}
          placeholder="Rice, eggs, olive oil"
          autoFocus
        />
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <Label.Root className={styles.fieldLabel} htmlFor={qtyId}>
              How much? (optional)
            </Label.Root>
            <input
              id={qtyId}
              className={styles.input}
              inputMode="decimal"
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value)}
              placeholder="Just note it"
              autoComplete="off"
              aria-invalid={qtyBad || undefined}
            />
          </div>
          <div className={styles.field}>
            <Label.Root className={styles.fieldLabel} htmlFor={unitId}>
              Unit
            </Label.Root>
            <Select.Root
              value={unit === "" ? NO_UNIT : unit}
              onValueChange={(next) => setUnit(next === NO_UNIT ? "" : next)}
            >
              <Select.Trigger id={unitId} className={cx(styles.input, styles.selectTrigger)}>
                <Select.Value />
              </Select.Trigger>
              <Select.Portal>
                <Select.Content className={styles.selectContent} position="popper" sideOffset={8} collisionPadding={12}>
                  <Select.Viewport className={styles.selectViewport}>
                    {UNITS.map(([value, label]) => (
                      <Select.Item
                        key={value === "" ? NO_UNIT : value}
                        value={value === "" ? NO_UNIT : value}
                        className={styles.selectItem}
                      >
                        <Select.ItemText>{label}</Select.ItemText>
                        <Select.ItemIndicator className={styles.selectIndicator}>
                          <Icon name="check" />
                        </Select.ItemIndicator>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </div>
        </div>
        {duplicate && <p className={styles.hint}>That's already in the pantry. Use the + and - on its row, or give an amount to add more.</p>}
        {add.isError && (
          <p className={styles.hint} role="alert">
            {ingredientErrorMessage(add.error, "Could not add it. Try again.")}
          </p>
        )}
      </form>
    </Sheet>
  );
}
