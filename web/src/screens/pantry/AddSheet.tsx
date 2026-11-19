import { useId, useState, type FormEvent } from "react";
import { Label } from "radix-ui";
import { Button, Sheet } from "@/ui";
import { IngredientPicker } from "../ingredients/IngredientPicker";
import { ingredientErrorMessage, type IngredientPick } from "../ingredients/refs";
import { UnitPicker } from "../ingredients/UnitPicker";
import { UnitProblems } from "../ingredients/UnitProblems";
import { unitProblems } from "../ingredients/units";
import { parseQty } from "../shop/format";
import styles from "./Pantry.module.css";
import { useAddStock } from "./queries";
import { type PantryItem } from "./stock";

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
  const unitIssues = add.isError ? unitProblems(add.error) : [];
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
      { ingredientId: pick.id, qty: qtyText.trim() === "" ? null : qty, unit: unit.trim() === "" ? null : unit.trim() },
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
          onChange={(next) => {
            setPick(next);
            setUnit("");
          }}
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
          {pick === null ? (
            <div className={styles.field}>
              <Label.Root className={styles.fieldLabel} htmlFor={unitId}>
                Unit
              </Label.Root>
              <input id={unitId} className={styles.input} disabled readOnly placeholder="Pick a food first" />
            </div>
          ) : (
            <UnitPicker
              key={pick.id}
              label="Unit"
              ingredientId={pick.id}
              value={unit}
              onChange={setUnit}
              invalid={unitIssues.length > 0}
            />
          )}
        </div>
        {duplicate && <p className={styles.hint}>That's already in the pantry. Use the + and - on its row, or give an amount to add more.</p>}
        {add.isError && unitIssues.length === 0 && (
          <p className={styles.hint} role="alert">
            {ingredientErrorMessage(add.error, "Could not add it. Try again.")}
          </p>
        )}
        <UnitProblems
          problems={unitIssues}
          onUseUnit={(next) => {
            setUnit(next);
            add.reset();
          }}
          onMeasureAdded={() => add.reset()}
        />
      </form>
    </Sheet>
  );
}
