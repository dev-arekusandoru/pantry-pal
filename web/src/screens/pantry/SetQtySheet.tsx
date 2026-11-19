import { useId, useState, type FormEvent } from "react";
import { Label, Select } from "radix-ui";
import { Link } from "@tanstack/react-router";
import { errorMessage } from "@/api";
import { Button, Icon, Sheet, Sticker, buttonClass, hasIcon, ingredientEmoji, toast } from "@/ui";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { CATEGORY_ORDER, aisleLabel } from "../aisles";
import { UnitPicker } from "../ingredients/UnitPicker";
import { UnitProblems } from "../ingredients/UnitProblems";
import { unitProblems, unitText, type UnitProblem } from "../ingredients/units";
import { parseQty, qtyToInput } from "../shop/format";
import styles from "./Pantry.module.css";
import { type PantryCategory, type PantryItem } from "./stock";

export interface PantryChanges {
  qty: number;
  /** The unit the amount is written in; the pantry stores it in the stock unit. Null = the row's own unit. */
  unit: string | null;
  expiresOn: string | null;
  category: PantryCategory;
  shelfLifeDays: number | null;
}

export interface SetQtySheetProps {
  /** The item being edited; null closes the sheet. */
  item: PantryItem | null;
  onClose: () => void;
  onSave: (item: PantryItem, changes: PantryChanges) => Promise<void>;
  /** Remove the row from the pantry entirely; the caller confirms with an Undo toast. */
  onRemove: (item: PantryItem) => void;
  /** Open the icon picker for this item's ingredient. */
  onEditIcon: (item: PantryItem) => void;
}

export function SetQtySheet({ item, onClose, onSave, onRemove, onEditIcon }: SetQtySheetProps) {
  return (
    <Sheet
      open={item !== null}
      onClose={onClose}
      title={item ? `${item.ingredient.name}: how much?` : "Set amount"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="pantry-set" variant="primary" disabled={item === null}>
            Save
          </Button>
        </>
      }
    >
      {item && <Form key={item.id} item={item} onClose={onClose} onSave={onSave} onRemove={onRemove} onEditIcon={onEditIcon} />}
    </Sheet>
  );
}

interface FormProps {
  item: PantryItem;
  onClose: () => void;
  onSave: (item: PantryItem, changes: PantryChanges) => Promise<void>;
  onRemove: (item: PantryItem) => void;
  onEditIcon: (item: PantryItem) => void;
}

function Form({ item, onClose, onSave, onRemove, onEditIcon }: FormProps) {
  const [text, setText] = useState(item.qty === null ? "" : qtyToInput(item.qty));
  const [expiresOn, setExpiresOn] = useState(item.expiresOn ?? "");
  const [category, setCategory] = useState<PantryCategory>(item.ingredient.category);
  const [shelfText, setShelfText] = useState(
    item.ingredient.shelfLifeDays === null ? "" : String(item.ingredient.shelfLifeDays),
  );
  const [confirming, setConfirming] = useState(false);
  const [unit, setUnit] = useState(item.unit === null || item.unit === "count" ? "" : unitText(item.unit));
  const [issues, setIssues] = useState<UnitProblem[]>([]);
  const [saving, setSaving] = useState(false);
  const amountId = useId();
  const expiryId = useId();
  const shelfId = useId();
  const categoryId = useId();
  const qty = parseQty(text);
  const name = item.ingredient.name;
  const shelfLifeDays = shelfText.trim() === "" ? null : Number(shelfText);
  const shelfBad = shelfLifeDays !== null && (!Number.isInteger(shelfLifeDays) || shelfLifeDays < 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (qty === null || shelfBad || saving) return;
    setIssues([]);
    setSaving(true);
    try {
      await onSave(item, {
        qty,
        unit: unit.trim() === "" ? null : unit.trim(),
        expiresOn: expiresOn === "" ? null : expiresOn,
        category,
        shelfLifeDays,
      });
      onClose();
    } catch (error) {
      const found = unitProblems(error);
      setIssues(found);
      if (found.length === 0) toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form id="pantry-set" className={styles.setForm} onSubmit={submit}>
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
      </div>
      <UnitPicker
        label="Unit"
        ingredientId={item.ingredientId}
        value={unit}
        placeholder={item.unit === null ? "Choose a unit" : unitText(item.unit)}
        invalid={issues.length > 0}
        onChange={(next) => {
          setUnit(next);
          setIssues([]);
        }}
      />
      <p className={styles.hint}>
        {item.ingredient.name} is stored in {item.unit === null || item.unit === "count" ? "its first unit" : unitText(item.unit)}. Another unit is converted.
      </p>
      <UnitProblems
        problems={issues}
        onUseUnit={(next) => {
          setUnit(next);
          setIssues([]);
        }}
        onMeasureAdded={() => setIssues([])}
      />
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
        <Label.Root className={styles.fieldLabel} htmlFor={categoryId}>
          Category
        </Label.Root>
        <Select.Root value={category} onValueChange={(next) => setCategory(next as PantryCategory)}>
          <Select.Trigger id={categoryId} className={styles.input}>
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
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Icon</span>
        <div className={styles.iconRow}>
          <Sticker
            emoji={ingredientEmoji(name, item.ingredient.imageUrl)}
            fallback={ingredientEmoji(name)}
            tone="plain"
            size={40}
            className={hasIcon(name, item.ingredient.imageUrl) ? undefined : styles.noIcon}
          />
          <Button onClick={() => onEditIcon(item)}>Change icon</Button>
          <Link to="/ingredients/$id" params={{ id: item.ingredient.id }} className={buttonClass({ variant: "ghost" })}>
            Ingredient page
          </Link>
        </div>
      </div>
      <div className={styles.removeRow}>
        <Button variant="dangerGhost" icon={<Icon name="trash" />} onClick={() => setConfirming(true)}>
          Remove from pantry
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Remove ${name}?`}
        confirmLabel="Remove"
        cancelLabel="Keep it"
        onConfirm={() => {
          onRemove(item);
          onClose();
        }}
      >
        {name} leaves the pantry along with its recorded amount. Undo from the toast puts it straight back.
      </ConfirmDialog>
    </form>
  );
}
