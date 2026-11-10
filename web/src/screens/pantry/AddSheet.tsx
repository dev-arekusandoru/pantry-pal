import { useId, useState, type FormEvent } from "react";
import { Label, Select } from "radix-ui";
import { Button, Icon, Sheet, cx } from "@/ui";
import { CATEGORY_ORDER, aisleLabel } from "../aisles";
import { parseQty } from "../shop/format";
import styles from "./Pantry.module.css";
import { useAddStock } from "./queries";
import { type PantryItem } from "./stock";

type Category = PantryItem["ingredient"]["category"];

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
  const [name, setName] = useState(initialName);
  const [qtyText, setQtyText] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState<Category>("other");
  const add = useAddStock();
  const nameId = useId();
  const qtyId = useId();
  const unitId = useId();
  const categoryId = useId();

  const qty = parseQty(qtyText);
  const qtyBad = qtyText.trim() !== "" && (qty === null || qty <= 0);
  const trimmed = name.trim();
  const duplicate =
    qtyText.trim() === "" &&
    existing.some((i) => i.ingredient.name.toLowerCase() === trimmed.toLowerCase());
  const canAdd = trimmed !== "" && !qtyBad && !duplicate;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canAdd) return;
    add.mutate(
      { name: trimmed, category, qty: qtyText.trim() === "" ? null : qty, unit: unit === "" ? null : unit },
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
        <div className={styles.field}>
          <Label.Root className={styles.fieldLabel} htmlFor={nameId}>
            What is it?
          </Label.Root>
          <input
            id={nameId}
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rice, eggs, olive oil"
            autoComplete="off"
            autoFocus
          />
        </div>
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
        <div className={styles.field}>
          <Label.Root className={styles.fieldLabel} htmlFor={categoryId}>
            Shopping aisle
          </Label.Root>
          <Select.Root value={category} onValueChange={(next) => setCategory(next as Category)}>
            <Select.Trigger id={categoryId} className={cx(styles.input, styles.selectTrigger)}>
              <Select.Value />
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className={styles.selectContent} position="popper" sideOffset={8} collisionPadding={12}>
                <Select.Viewport className={styles.selectViewport}>
                  {CATEGORY_ORDER.map((c) => (
                    <Select.Item key={c} value={c} className={styles.selectItem}>
                      <Select.ItemText>{aisleLabel(c)}</Select.ItemText>
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
        {duplicate && <p className={styles.hint}>That's already in the pantry. Use the + and - on its row, or give an amount to add more.</p>}
      </form>
    </Sheet>
  );
}
