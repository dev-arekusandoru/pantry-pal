import { Link } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Button, Card, Checkbox, EmptyState, ErrorState, Icon, PageHeader, Skeleton, buttonClass, cx, ingredientEmoji, toast } from "@/ui";
import { aisleLabel, uncheckedFirst, type ShoppingItem, type ShoppingList } from "./cart";
import { DoneSheet } from "./DoneSheet";
import { formatAmount } from "./format";
import styles from "./Shop.module.css";
import { useAddItem, useCheckItem, useGenerateList, useShoppingList } from "./queries";

export interface ShopListProps {
  list: ShoppingList;
  /** Rendered under the header (the list switcher). */
  switcher: ReactNode;
  /** Leave a finished list. */
  onClose: () => void;
  /** The trip was completed; keep the list in the URL so the done state stays up. */
  onCompleted: () => void;
}

export function ShopList({ list, switcher, onClose, onCompleted }: ShopListProps) {
  const detail = useShoppingList(list.id);
  const check = useCheckItem(list.id);
  const add = useAddItem(list.id);
  const regenerate = useGenerateList();
  const [name, setName] = useState("");
  const [doneOpen, setDoneOpen] = useState(false);

  const checked = useMemo(
    () =>
      (detail.data?.items ?? [])
        .filter((i) => i.checkedAt !== null)
        .sort((a, b) => (a.checkedAt ?? "").localeCompare(b.checkedAt ?? "")),
    [detail.data],
  );

  if (detail.error && !detail.data) {
    return (
      <>
        <PageHeader title="Shopping" />
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </>
    );
  }
  if (!detail.data) {
    return (
      <div aria-busy="true" aria-label="Loading your list">
        <PageHeader title="Shopping" />
        <div className={styles.skeletons}>
          <Skeleton height={20} radius={999} />
          <Skeleton height={68} radius={24} />
          <Skeleton height={68} radius={24} />
          <Skeleton height={68} radius={24} />
        </div>
      </div>
    );
  }

  const { counts, groups } = detail.data;
  const current = detail.data.list;
  const pct = counts.total === 0 ? 0 : Math.round((counts.checked / counts.total) * 100);

  if (current.status === "done") {
    return (
      <>
        <PageHeader title="Shopping" sub={current.title} />
        {switcher}
        <EmptyState
          emoji="🎉"
          title="Shopping done!"
          action={
            <>
              <Link to="/pantry" className={buttonClass({ variant: "primary", size: "lg" })}>
                See the pantry
              </Link>
              <Button variant="ghost" onClick={onClose}>
                Close this list
              </Button>
            </>
          }
        >
          {counts.checked === 0
            ? "That's the trip wrapped up."
            : `${counts.checked} ${counts.checked === 1 ? "thing" : "things"} went into your pantry.`}
        </EmptyState>
      </>
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = name.trim();
    if (!text) return;
    add.mutate(text, {
      onSuccess: () => {
        setName("");
        toast.show({ message: `Added ${text}` });
      },
    });
  }

  function update() {
    if (current.mealPlanId === null) return;
    regenerate.mutate(
      { mealPlanId: current.mealPlanId, listId: current.id },
      { onSuccess: () => toast.show({ message: "List updated" }) },
    );
  }

  return (
    <>
      <PageHeader
        title="Shopping"
        sub={counts.total === 0 ? current.title : counts.remaining === 0 ? "All in the basket" : `${counts.remaining} to go`}
        aside={
          counts.total > 0 && (
            <div className={styles.count}>
              <span className={styles.countN}>{counts.checked}</span>
              <span className={styles.countOf}>of {counts.total}</span>
            </div>
          )
        }
      />
      {switcher}

      {counts.total > 0 && (
        <div className={styles.meter} role="progressbar" aria-label="Shopping progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}

      {current.stale && current.mealPlanId !== null && (
        <Card className={styles.stale} role="status">
          <span className={styles.staleText}>
            <b>Your plan changed.</b> Update the list to match. Things you added or checked off stay.
          </span>
          <Button variant="primary" icon={<Icon name="refresh" />} loading={regenerate.isPending} onClick={update}>
            Update the list
          </Button>
        </Card>
      )}

      <form className={styles.addBar} onSubmit={submit}>
        <input
          className={styles.addInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add something we forgot"
          aria-label="Add an item"
          autoComplete="off"
          enterKeyHint="done"
        />
        <Button type="submit" variant="primary" icon={<Icon name="plus" />} loading={add.isPending} disabled={name.trim() === ""}>
          Add
        </Button>
      </form>

      {counts.total === 0 ? (
        <EmptyState emoji="🧺" title="Nothing on this list">
          Add what you need above.
        </EmptyState>
      ) : (
        <div className={styles.aisles}>
          {groups.map((g) => {
            const left = g.items.filter((i) => i.checkedAt === null).length;
            return (
              <section key={g.category} className={styles.aisle} aria-label={aisleLabel(g.category)}>
                <h2 className={styles.aisleName}>
                  <span>{aisleLabel(g.category)}</span>
                  <small>{left > 0 ? `${left} left` : "all in the basket"}</small>
                </h2>
                <ul className={styles.items}>
                  {uncheckedFirst(g.items).map((item) => (
                    <ItemRow key={item.id} item={item} onToggle={(checkedNow) => check.mutate({ itemId: item.id, checked: checkedNow })} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {counts.total > 0 && (
        <div className={styles.finish}>
          <Button variant="primary" size="lg" icon={<Icon name="check" />} onClick={() => setDoneOpen(true)}>
            Done shopping
          </Button>
          <p>Checked items go into the pantry.</p>
        </div>
      )}

      <DoneSheet
        open={doneOpen}
        onClose={() => setDoneOpen(false)}
        listId={list.id}
        checked={checked}
        remaining={counts.remaining}
        onCompleted={() => {
          setDoneOpen(false);
          onCompleted();
        }}
      />
    </>
  );
}

function ItemRow({ item, onToggle }: { item: ShoppingItem; onToggle: (checked: boolean) => void }) {
  const got = item.checkedAt !== null;
  const qty = formatAmount(item.qty, item.unit);
  const why = item.note ?? item.purposeNote ?? (item.source === "manual" ? "Added by hand" : null);
  return (
    <li className={cx(styles.item, got && styles.got)}>
      <Checkbox checked={got} onChange={onToggle} aria-label={item.name}>
        <span className={styles.itemEmoji} aria-hidden="true">
          {ingredientEmoji(item.name)}
        </span>
        <span className={styles.itemBody}>
          <span className={styles.itemName}>{item.name}</span>
          {why && <span className={styles.itemWhy}>{why}</span>}
        </span>
        {qty && <span className={styles.itemQty}>{qty}</span>}
      </Checkbox>
    </li>
  );
}
