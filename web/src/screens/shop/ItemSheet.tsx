import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { errorMessage } from "@/api";
import { Button, Emoji, Icon, IconPicker, SegmentedControl, Sheet, buttonClass, ingredientEmoji, toast } from "@/ui";
import type { ShoppingItem } from "./cart";
import { UnitPicker } from "../ingredients/UnitPicker";
import { UnitProblems } from "../ingredients/UnitProblems";
import { unitProblems, unitText, type UnitProblem } from "../ingredients/units";
import { parseQty, qtyToInput, unitLabel } from "./format";
import styles from "./Shop.module.css";
import { useRemoveItem, useUpdateItemQty, type PantryMode } from "./queries";

export interface ItemSheetProps {
  listId: string;
  /** The item to show; null keeps the sheet closed. */
  item: ShoppingItem | null;
  onClose: () => void;
}

export function ItemSheet({ listId, item, onClose }: ItemSheetProps) {
  return (
    <Sheet open={item !== null} onClose={onClose} title={item?.name ?? ""}>
      {item && <ItemDetail key={item.id} listId={listId} item={item} onClose={onClose} />}
    </Sheet>
  );
}

/** Empty text means "no amount"; null means the text is not a number. */
function parseOptionalQty(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  return parseQty(text) ?? undefined;
}

const FLAG = /^(running low|check the pantry|(some )?units don't convert)/;
// "Lemon Chicken 2 tbsp": a recipe title, then an amount with an optional unit.
const USE = /^(.+?) (\d+(?:\.\d+)?)(?: (\S+))?$/;

/** Splits the generated note ("A 2 tbsp + B 1 lb; check the pantry") into recipe rows and warning chips. */
function UsedIn({ item }: { item: ShoppingItem }) {
  const segments = (item.purposeNote ?? "").split("; ").filter(Boolean);
  const flags = segments.filter((s) => FLAG.test(s));
  const uses = segments
    .filter((s) => !FLAG.test(s))
    .flatMap((s) => s.split(" + "))
    .map((s) => {
      const m = USE.exec(s);
      return m ? { title: m[1]!, amount: m[3] ? `${m[2]} ${m[3]}` : m[2]! } : { title: s, amount: null };
    });
  if (item.note) uses.push({ title: item.note, amount: null });
  if (uses.length === 0 && flags.length === 0) {
    return <p className={styles.usedEmpty}>{item.source === "manual" ? "Added by hand" : "Not linked to a recipe"}</p>;
  }
  return (
    <section className={styles.usedIn} aria-label="Used in">
      <span className={styles.usedLabel}>Used in</span>
      <ul className={styles.usedList}>
        {uses.map((u) => (
          <li key={u.title} className={styles.usedRow}>
            <span className={styles.usedTitle}>{u.title}</span>
            {u.amount && <span className={styles.usedAmount}>{u.amount}</span>}
          </li>
        ))}
      </ul>
      {flags.length > 0 && (
        <div className={styles.usedFlags}>
          {flags.map((f) => (
            <span key={f} className={styles.usedFlag}>
              {f}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function ItemDetail({ listId, item, onClose }: { listId: string; item: ShoppingItem; onClose: () => void }) {
  const [text, setText] = useState(item.qty === null ? "" : qtyToInput(item.qty));
  const [pickingIcon, setPickingIcon] = useState(false);
  const [unit, setUnit] = useState(item.unit === null || item.unit === "count" ? "" : unitText(item.unit));
  const [issues, setIssues] = useState<UnitProblem[]>([]);
  // Set once "I have it" is tapped: the amount to add to the pantry, which can differ from the list.
  const [pantryText, setPantryText] = useState<string | null>(null);
  const [pantryUnit, setPantryUnit] = useState(item.unit === null || item.unit === "count" ? "" : unitText(item.unit));
  const [pantryMode, setPantryMode] = useState<PantryMode>("add");
  const update = useUpdateItemQty(listId);
  const remove = useRemoveItem(listId);
  const qty = parseOptionalQty(text);
  const pantryQty = pantryText === null ? null : parseOptionalQty(pantryText);

  const unitChanged = unit.trim() !== (item.unit === null || item.unit === "count" ? "" : unitText(item.unit));

  const run = (promise: Promise<unknown>, message?: string) =>
    promise.then(
      () => {
        if (message) toast.show({ message });
        onClose();
      },
      (error) => {
        const found = unitProblems(error);
        setIssues(found);
        if (found.length === 0) toast.error(errorMessage(error));
      },
    );

  return (
    <div className={styles.addForm}>
      {item.ingredientId !== null ? (
        <button
          type="button"
          className={styles.sheetHero}
          aria-label={`Change the icon for ${item.name}`}
          onClick={() => setPickingIcon(true)}
        >
          <Emoji code={ingredientEmoji(item.name, item.imageUrl)} fallback={ingredientEmoji(item.name)} size={88} />
          <span className={styles.heroEdit} aria-hidden="true">
            <Icon name="swap" />
          </span>
        </button>
      ) : (
        <div className={styles.sheetHero} aria-hidden="true">
          <Emoji code={ingredientEmoji(item.name, item.imageUrl)} fallback={ingredientEmoji(item.name)} size={88} />
        </div>
      )}
      {item.ingredientId !== null && (
        <IconPicker
          ingredient={pickingIcon ? { id: item.ingredientId, name: item.name, imageUrl: item.imageUrl } : null}
          onClose={() => setPickingIcon(false)}
        />
      )}
      <UsedIn item={item} />
      {item.ingredientId !== null && (
        <Link to="/ingredients/$id" params={{ id: item.ingredientId }} className={buttonClass({ variant: "ghost" })}>
          Ingredient page
        </Link>
      )}
      <div className={styles.addField}>
        <label htmlFor="shop-item-qty">Quantity to buy</label>
        <span className={styles.qtyEdit}>
          <input
            id="shop-item-qty"
            className={styles.qtyInput}
            inputMode="decimal"
            autoComplete="off"
            placeholder="some"
            aria-invalid={qty === undefined || undefined}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
          {item.ingredientId === null && qty != null && <span className={styles.qtyUnit}>{unitLabel(item.unit, qty)}</span>}
          <Button
            variant="primary"
            loading={update.isPending}
            disabled={qty === undefined || (qty === item.qty && !unitChanged)}
            onClick={() => {
              setIssues([]);
              void run(
                update.mutateAsync({
                  itemId: item.id,
                  qty: qty!,
                  ...(item.ingredientId !== null && unitChanged ? { unit: unit.trim() === "" ? null : unit.trim() } : {}),
                }),
              );
            }}
          >
            Save
          </Button>
        </span>
      </div>
      {item.ingredientId !== null && pantryText === null && (
        <>
          <UnitPicker
            label="Unit"
            ingredientId={item.ingredientId}
            value={unit}
            invalid={issues.length > 0}
            onChange={(next) => {
              setUnit(next);
              setIssues([]);
            }}
          />
          <UnitProblems
            problems={issues}
            onUseUnit={(next) => {
              setUnit(next);
              setIssues([]);
            }}
            onMeasureAdded={() => setIssues([])}
          />
        </>
      )}
      {pantryText === null ? (
        <div className={styles.sheetActions}>
          {item.ingredientId !== null && (
            <Button
              icon={<Icon name="pantry" />}
              disabled={remove.isPending}
              onClick={() => setPantryText(item.qty === null ? "" : qtyToInput(item.qty))}
            >
              I have it
            </Button>
          )}
          <Button
            variant="dangerGhost"
            icon={<Icon name="trash" />}
            disabled={remove.isPending}
            onClick={() => run(remove.mutateAsync({ item }))}
          >
            Remove
          </Button>
        </div>
      ) : (
        <div className={styles.addField}>
          <SegmentedControl<PantryMode>
            label="Record it as"
            value={pantryMode}
            onChange={(next) => setPantryMode(next)}
            options={[
              { value: "add", label: "Add to pantry" },
              { value: "set", label: "Set what I have" },
            ]}
          />
          <label htmlFor="shop-item-pantry-qty">
            {pantryMode === "add" ? "How much goes into the pantry?" : "How much do you have now?"}
          </label>
          <span className={styles.qtyEdit}>
            <input
              id="shop-item-pantry-qty"
              className={styles.qtyInput}
              inputMode="decimal"
              autoComplete="off"
              placeholder="some"
              autoFocus
              aria-invalid={pantryQty === undefined || undefined}
              value={pantryText}
              onChange={(e) => setPantryText(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
            />
            {item.ingredientId === null && pantryQty != null && (
              <span className={styles.qtyUnit}>{unitLabel(item.unit, pantryQty)}</span>
            )}
          </span>
          {item.ingredientId !== null && (
            <>
              <UnitPicker
                label="Unit"
                ingredientId={item.ingredientId}
                value={pantryUnit}
                invalid={issues.length > 0}
                onChange={(next) => {
                  setPantryUnit(next);
                  setIssues([]);
                }}
              />
              <UnitProblems
                problems={issues}
                onUseUnit={(next) => {
                  setPantryUnit(next);
                  setIssues([]);
                }}
                onMeasureAdded={() => setIssues([])}
              />
            </>
          )}
          <Button
            variant="primary"
            loading={remove.isPending}
            disabled={pantryQty === undefined}
            onClick={() => {
              setIssues([]);
              void run(
                remove.mutateAsync({
                  item,
                  pantry: {
                    qty: pantryQty!,
                    mode: pantryMode,
                    ...(item.ingredientId !== null ? { unit: pantryUnit.trim() === "" ? null : pantryUnit.trim() } : {}),
                  },
                }),
                `${item.name} ${pantryMode === "add" ? "added to" : "set in"} your pantry`,
              );
            }}
          >
            {pantryMode === "add" ? "Add to pantry and remove" : "Set in pantry and remove"}
          </Button>
          <Button variant="ghost" disabled={remove.isPending} onClick={() => setPantryText(null)}>
            Back
          </Button>
        </div>
      )}
    </div>
  );
}
