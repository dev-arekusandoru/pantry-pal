import { DropdownMenu } from "radix-ui";
import { Icon, Pill, Stepper, Sticker, ingredientEmoji, type PillTone } from "@/ui";
import { formatQty, unitLabel } from "../shop/format";
import styles from "./Pantry.module.css";
import { STATUS_LABEL, type PantryItem, type PantryStatus } from "./stock";

const STATUS_TONE: Record<PantryStatus, PillTone> = {
  on_hand: "pistachio",
  low: "butter",
  out: "tomato",
  unknown: "neutral",
};

/** Statuses the row menu offers; "unknown" is only ever set by the server. */
const STATUS_CHOICES = ["on_hand", "low", "out"] as const;

export interface StockRowProps {
  item: PantryItem;
  onStep: (item: PantryItem, direction: 1 | -1) => void;
  onEditQty: (item: PantryItem) => void;
  onSetStatus: (item: PantryItem, status: PantryStatus) => void;
}

export function StockRow({ item, onStep, onEditQty, onSetStatus }: StockRowProps) {
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
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            className={styles.statusBtn}
            aria-label={`${name}: ${STATUS_LABEL[item.status].toLowerCase()}. Change status`}
          >
            <Pill tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Pill>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={styles.menu} sideOffset={6} align="end" collisionPadding={12}>
              <DropdownMenu.Label className={styles.menuLabel}>Status</DropdownMenu.Label>
              <DropdownMenu.RadioGroup
                value={item.status}
                onValueChange={(status) => onSetStatus(item, status as PantryStatus)}
              >
                {STATUS_CHOICES.map((status) => (
                  <DropdownMenu.RadioItem key={status} value={status} className={styles.menuItem}>
                    {STATUS_LABEL[status]}
                    <DropdownMenu.ItemIndicator className={styles.menuIndicator}>
                      <Icon name="check" />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
              <DropdownMenu.Separator className={styles.menuSep} />
              <DropdownMenu.Item className={styles.menuItem} onSelect={() => onEditQty(item)}>
                Set an exact amount…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </li>
  );
}
