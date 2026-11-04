import { Pill, Stepper, Sticker, ingredientEmoji, type PillTone } from "@/ui";
import { formatQty, unitLabel } from "../shop/format";
import styles from "./Pantry.module.css";
import { STATUS_LABEL, type PantryItem, type PantryStatus } from "./stock";

const STATUS_TONE: Record<PantryStatus, PillTone> = {
  on_hand: "pistachio",
  low: "butter",
  out: "tomato",
  unknown: "neutral",
};

export interface StockRowProps {
  item: PantryItem;
  onStep: (item: PantryItem, direction: 1 | -1) => void;
  onEditQty: (item: PantryItem) => void;
  onCycleStatus: (item: PantryItem) => void;
}

export function StockRow({ item, onStep, onEditQty, onCycleStatus }: StockRowProps) {
  const name = item.ingredient.name;
  const measured = item.qty !== null;
  const note = measured ? (item.status === "on_hand" ? null : STATUS_LABEL[item.status]) : item.note;
  return (
    <li className={styles.row}>
      <Sticker emoji={ingredientEmoji(name)} tone="plain" size={46} />
      <button type="button" className={styles.body} onClick={() => onEditQty(item)}>
        <span className={styles.name}>{name}</span>
        {note && <span className={styles.note}>{note}</span>}
      </button>
      {item.qty !== null ? (
        <Stepper
          label={name}
          value={formatQty(item.qty)}
          unit={unitLabel(item.unit, item.qty)}
          onDecrement={() => onStep(item, -1)}
          onIncrement={() => onStep(item, 1)}
          disableDecrement={item.qty <= 0}
          onValueClick={() => onEditQty(item)}
          valueLabel={`${name}: ${formatQty(item.qty)} ${unitLabel(item.unit, item.qty)}. Set an exact amount`.replace(" .", ".")}
        />
      ) : (
        <button
          type="button"
          className={styles.statusBtn}
          aria-label={`${name}: ${STATUS_LABEL[item.status].toLowerCase()}. Tap to change`}
          onClick={() => onCycleStatus(item)}
        >
          <Pill tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Pill>
        </button>
      )}
    </li>
  );
}
