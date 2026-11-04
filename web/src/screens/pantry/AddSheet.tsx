import { useState, type FormEvent } from "react";
import { Button, SegmentedControl, Sheet } from "@/ui";
import { aisleLabel } from "../shop/cart";
import { parseQty } from "../shop/format";
import styles from "./Pantry.module.css";
import { useAddStock } from "./queries";
import { LOCATION_LABEL, LOCATION_ORDER, type PantryItem, type StorageLocation } from "./stock";

type Category = PantryItem["ingredient"]["category"];

const CATEGORIES: readonly Category[] = [
  "produce",
  "protein",
  "dairy",
  "bakery",
  "pantry",
  "baking",
  "spice",
  "canned",
  "condiment",
  "frozen",
  "beverage",
  "other",
];

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
  initialLocation?: StorageLocation;
}

export function AddSheet(props: AddSheetProps) {
  // Mounted only while open, so every open starts with a blank form.
  return props.open ? <AddForm {...props} /> : null;
}

function AddForm({ onClose, existing, initialName = "", initialLocation = "pantry" }: AddSheetProps) {
  const [name, setName] = useState(initialName);
  const [qtyText, setQtyText] = useState("");
  const [unit, setUnit] = useState("");
  const [location, setLocation] = useState<StorageLocation>(initialLocation);
  const [category, setCategory] = useState<Category>("other");
  const add = useAddStock();

  const qty = parseQty(qtyText);
  const qtyBad = qtyText.trim() !== "" && (qty === null || qty <= 0);
  const trimmed = name.trim();
  const duplicate =
    qtyText.trim() === "" &&
    existing.some((i) => i.location === location && i.ingredient.name.toLowerCase() === trimmed.toLowerCase());
  const canAdd = trimmed !== "" && !qtyBad && !duplicate;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canAdd) return;
    add.mutate(
      { name: trimmed, category, location, qty: qtyText.trim() === "" ? null : qty, unit: unit === "" ? null : unit },
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
        <label className={styles.field}>
          <span>What is it?</span>
          <input
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rice, eggs, olive oil"
            autoComplete="off"
            autoFocus
          />
        </label>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>How much? (optional)</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value)}
              placeholder="Just a staple"
              autoComplete="off"
              aria-invalid={qtyBad || undefined}
            />
          </label>
          <label className={styles.field}>
            <span>Unit</span>
            <select className={styles.input} value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.field}>
          <span>Where does it live?</span>
          <SegmentedControl
            label="Where does it live?"
            options={LOCATION_ORDER.map((l) => ({ value: l, label: LOCATION_LABEL[l] }))}
            value={location}
            onChange={setLocation}
          />
        </div>
        <label className={styles.field}>
          <span>Shopping aisle</span>
          <select className={styles.input} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {aisleLabel(c)}
              </option>
            ))}
          </select>
        </label>
        {duplicate && <p className={styles.hint}>That's already in this spot. Use the + and - on its row, or give an amount to add more.</p>}
      </form>
    </Sheet>
  );
}
