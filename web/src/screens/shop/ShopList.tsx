import { Link } from "@tanstack/react-router";
import { AlertDialog, Checkbox, Collapsible, Label, Progress } from "radix-ui";
import { useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Button, Card, Emoji, EmptyState, ErrorState, Fab, Icon, IconButton, PageHeader, Sheet, Skeleton, buttonClass, cx, ingredientEmoji, toast } from "@/ui";
import { aisleLabel, uncheckedFirst, type ShoppingItem, type ShoppingList } from "./cart";
import { DoneSheet } from "./DoneSheet";
import { formatAmount } from "./format";
import styles from "./Shop.module.css";
import { useAddItem, useCheckItem, useClearList, useGenerateList, useShoppingList } from "./queries";

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
  const clear = useClearList(list.id);
  const regenerate = useGenerateList();
  const [name, setName] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const addFieldId = useId();

  const checked = useMemo(
    () =>
      (detail.data?.items ?? [])
        .filter((i) => i.checkedAt !== null)
        .sort((a, b) => (a.checkedAt ?? "").localeCompare(b.checkedAt ?? "")),
    [detail.data],
  );

  // One-way latch: did this screen ever show its skeleton? Content that replaces
  // a skeleton fades in; a first paint that already has data is left to the
  // route transition, so the two never fade the same frame.
  const sawLoading = useRef(false);
  if (!detail.data) sawLoading.current = true;

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
        <div className={sawLoading.current ? styles.enter : undefined}>
          {switcher}
          <EmptyState
            emoji="1F389"
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
        </div>
      </>
    );
  }

  function closeAdd() {
    setAddOpen(false);
    setName("");
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = name.trim();
    if (!text) return;
    add.mutate(text, {
      onSuccess: () => {
        closeAdd();
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

  function confirmClear() {
    clear.mutate(undefined, {
      onSuccess: () => {
        setClearOpen(false);
        toast.show({ message: "List cleared" });
      },
    });
  }

  return (
    <>
      <PageHeader
        title="Shopping"
        sub={counts.total === 0 ? current.title : counts.remaining === 0 ? "All in the basket" : `${counts.remaining} to go`}
        aside={
          counts.total > 0 && (
            <div className={cx(styles.count, sawLoading.current && styles.countIn)}>
              <span className={styles.countN}>{counts.checked}</span>
              <span className={styles.countOf}>of {counts.total}</span>
            </div>
          )
        }
      />
      <div className={sawLoading.current ? styles.enter : undefined}>
        {switcher}

        {counts.total > 0 && (
          <Progress.Root className={styles.meter} value={pct} aria-label="Shopping progress">
            {/* scaleX instead of width: the fill never touches layout, so the meter cannot jitter. */}
            <Progress.Indicator className={styles.meterFill} style={{ "--pct": pct / 100 } as CSSProperties} />
          </Progress.Root>
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

        {counts.total === 0 ? (
          <EmptyState emoji="1F9FA" title="Nothing on this list" className={styles.screen}>
            Add what you need with the plus button.
          </EmptyState>
        ) : (
          <div className={styles.aisles}>
            {groups.map((g) => {
              const left = g.items.filter((i) => i.checkedAt === null).length;
              const label = aisleLabel(g.category);
              return (
                <Collapsible.Root key={g.category} className={styles.aisle} defaultOpen>
                  <h2 className={styles.aisleName}>
                    <Collapsible.Trigger className={styles.aisleTrigger}>
                      <span>{label}</span>
                      <span className={styles.aisleMeta}>
                        <small>{left > 0 ? `${left} left` : "all in the basket"}</small>
                        <Icon name="back" className={styles.aisleChev} />
                      </span>
                    </Collapsible.Trigger>
                  </h2>
                  <Collapsible.Content className={styles.aisleContent}>
                    <ul className={styles.items}>
                      {uncheckedFirst(g.items).map((item) => (
                        <ItemRow key={item.id} item={item} onToggle={(checkedNow) => check.mutate({ itemId: item.id, checked: checkedNow })} />
                      ))}
                    </ul>
                  </Collapsible.Content>
                </Collapsible.Root>
              );
            })}
          </div>
        )}

        {counts.total > 0 && (
          <div className={cx(styles.finish, styles.screen)}>
            <Button variant="primary" size="lg" icon={<Icon name="check" />} onClick={() => setDoneOpen(true)}>
              Done shopping
            </Button>
            <p>Checked items go into the pantry.</p>
            <Button variant="secondary" icon={<Icon name="trash" />} className={styles.clear} onClick={() => setClearOpen(true)}>
              Clear list
            </Button>
          </div>
        )}
      </div>

      <Fab label="Add an item" showLabel onClick={() => setAddOpen(true)} />

      <Sheet
        open={addOpen}
        onClose={closeAdd}
        title="Add an item"
        footer={
          <>
            <Button onClick={closeAdd}>Cancel</Button>
            <Button type="submit" form="shop-add" variant="primary" loading={add.isPending} disabled={name.trim() === ""}>
              Add
            </Button>
          </>
        }
      >
        <form id="shop-add" className={styles.addForm} onSubmit={submit}>
          <div className={styles.addField}>
            <Label.Root htmlFor={addFieldId}>What do you need?</Label.Root>
            <input
              id={addFieldId}
              className={styles.addInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Milk, lemons, dish soap"
              autoComplete="off"
              enterKeyHint="done"
              autoFocus
            />
          </div>
        </form>
      </Sheet>

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

      <AlertDialog.Root open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className={styles.confirmBackdrop} />
          <AlertDialog.Content className={styles.confirmPanel}>
            <header className={styles.confirmHead}>
              <AlertDialog.Title className={styles.confirmTitle}>Clear the list?</AlertDialog.Title>
              <AlertDialog.Cancel asChild>
                <IconButton label="Close" icon={<Icon name="close" />} variant="plain" />
              </AlertDialog.Cancel>
            </header>
            <div className={styles.confirmBody}>
              <AlertDialog.Description className={styles.sheetNote}>
                Every item on this list will be removed — checked off or not, added by hand or from the plan. Nothing goes into
                your pantry.
                {current.mealPlanId !== null && " You can rebuild the list from your plan afterwards."}
              </AlertDialog.Description>
            </div>
            <div className={styles.confirmFooter}>
              <AlertDialog.Cancel asChild>
                <Button>Keep the list</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  variant="primary"
                  loading={clear.isPending}
                  onClick={(e) => {
                    // Keep the dialog open while the request is in flight; it closes on success.
                    e.preventDefault();
                    confirmClear();
                  }}
                >
                  Clear list
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

function ItemRow({ item, onToggle }: { item: ShoppingItem; onToggle: (checked: boolean) => void }) {
  const got = item.checkedAt !== null;
  const qty = formatAmount(item.qty, item.unit);
  const why = item.note ?? item.purposeNote ?? (item.source === "manual" ? "Added by hand" : null);
  return (
    <li className={cx(styles.item, got && styles.got)}>
      <Checkbox.Root
        className={styles.itemCheck}
        checked={got}
        onCheckedChange={(next) => onToggle(next === true)}
        aria-label={item.name}
      >
        <span className={styles.itemBox} aria-hidden="true">
          <Checkbox.Indicator className={styles.itemCheckMark} forceMount>
            <Icon name="check" />
          </Checkbox.Indicator>
        </span>
        <span className={styles.itemContent}>
          <span className={styles.itemEmoji} aria-hidden="true">
            <Emoji code={ingredientEmoji(item.name)} size={26} />
          </span>
          <span className={styles.itemBody}>
            <span className={styles.itemName}>{item.name}</span>
            {why && <span className={styles.itemWhy}>{why}</span>}
          </span>
          {qty && <span className={styles.itemQty}>{qty}</span>}
        </span>
      </Checkbox.Root>
    </li>
  );
}
