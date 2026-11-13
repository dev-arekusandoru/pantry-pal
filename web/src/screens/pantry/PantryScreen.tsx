import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { errorMessage } from "@/api";
import { Button, Card, EmptyState, ErrorState, Icon, IconPicker, PageHeader, SearchInput, SegmentedControl, Skeleton, buttonClass, cx, toast } from "@/ui";
import { AddSheet } from "./AddSheet";
import styles from "./Pantry.module.css";
import { useAddToList, useAdjustItem, usePantry, useRemoveItem, useRestoreItem, useSetExpiry, useSetQty, useSetCategory, useSetShelfLife, useSetStatus } from "./queries";
import { SetQtySheet } from "./SetQtySheet";
import { StockRow } from "./StockRow";
import { SweepSheet } from "./sweep/SweepSheet";
import { CATEGORY_ORDER, aisleLabel } from "../aisles";
import { groupByCategory, stepFor, type PantryCategory, type PantryItem } from "./stock";

export function PantryScreen() {
  const pantry = usePantry();
  const adjust = useAdjustItem();
  const setQty = useSetQty();
  const setExpiry = useSetExpiry();
  const setShelfLife = useSetShelfLife();
  const setCategory = useSetCategory();
  const addToList = useAddToList();
  const setStatus = useSetStatus();
  const remove = useRemoveItem();
  const restore = useRestoreItem();
  const [query, setQuery] = useState("");
  const [category, setCategoryFilter] = useState<PantryCategory | "all">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [iconIngredient, setIconIngredient] = useState<{ id: string; name: string; imageUrl: string | null } | null>(null);

  const items = pantry.data;
  // Derive from the query so an edit made in a nested sheet shows up here too.
  const editing = items?.find((i) => i.id === editingId) ?? null;
  const editIcon = (item: PantryItem) =>
    setIconIngredient({ id: item.ingredient.id, name: item.ingredient.name, imageUrl: item.ingredient.imageUrl });
  const groups = useMemo(() => groupByCategory(items ?? [], query, category), [items, query, category]);
  // One-way latch: did this screen ever show its skeleton? Rows and the block
  // fade in only when they replace a skeleton; a first paint that already has
  // data is left to the route transition, so the two never fade the same frame.
  const sawLoading = useRef(false);
  if (!items) sawLoading.current = true;

  const addButton = (
    <Button variant="primary" icon={<Icon name="plus" />} onClick={() => setAdding(true)}>
      Add
    </Button>
  );
  const stickerBook = (
    <Link to="/dex" className={buttonClass({ variant: "ghost" })}>
      Sticker book
    </Link>
  );

  if (pantry.error && !items) {
    return (
      <>
        <PageHeader title="Pantry" />
        <ErrorState error={pantry.error} onRetry={() => void pantry.refetch()} />
      </>
    );
  }
  if (!items) {
    return (
      <div aria-busy="true" aria-label="Loading the pantry">
        <PageHeader title="Pantry" />
        <div className={styles.skeletons}>
          <Skeleton height={54} radius={999} />
          <Skeleton height={44} radius={999} width="70%" />
          {/* One shelf with three rows: close to the real block so content does not jump. */}
          <Skeleton height={260} radius={30} />
        </div>
      </div>
    );
  }

  // Only offer categories that hold something; a filter that empties out falls back to everything.
  const present = CATEGORY_ORDER.filter((c) => items.some((i) => i.ingredient.category === c));
  const activeCategory = category === "all" || present.includes(category) ? category : "all";

  return (
    <>
      <div className={cx(styles.screen, sawLoading.current && styles.screenIn)} data-rows={sawLoading.current || undefined}>
        <PageHeader
          title="Pantry"
          sub={items.length === 0 ? "Nothing in the pantry yet" : `${items.length} ${items.length === 1 ? "thing" : "things"} in the pantry`}
          aside={
            <div className={styles.actions}>
              {stickerBook}
              {items.length > 0 && (
                <>
                  <Button icon={<Icon name="timer" />} onClick={() => setSweeping(true)}>
                    Sweep
                  </Button>
                  {addButton}
                </>
              )}
            </div>
          }
        />
        {items.length === 0 ? (
          <EmptyState emoji="relish" title="Your pantry is empty" action={addButton}>
            Add what you have and PantryPal can plan around it.
          </EmptyState>
        ) : (
          <>
            <div className={styles.tools}>
              <SearchInput label="Search the pantry" value={query} onChange={setQuery} />
              {present.length > 1 && (
                <SegmentedControl<PantryCategory | "all">
                  label="Filter by category"
                  value={activeCategory}
                  onChange={setCategoryFilter}
                  options={[{ value: "all", label: "Everything" }, ...present.map((c) => ({ value: c, label: aisleLabel(c) }))]}
                />
              )}
            </div>
            {groups.length === 0 ? (
              <EmptyState
                emoji="empty-bowl"
                title={`Nothing matches "${query.trim()}"`}
                action={
                  <Button variant="primary" icon={<Icon name="plus" />} onClick={() => setAdding(true)}>
                    Add it to the pantry
                  </Button>
                }
              >
                Try another name, or add it.
              </EmptyState>
            ) : (
              groups.map((g) => (
                <Card key={g.category} as="section" radius="xl" className={styles.shelf} data-ui="shelf" aria-label={aisleLabel(g.category)}>
                  <h2 className={styles.shelfName}>
                    {aisleLabel(g.category)}
                    <small>{g.items.length}</small>
                  </h2>
                  <ul data-ui="shelf-list">
                    {g.items.map((item) => (
                      <StockRow
                        key={item.id}
                        item={item}
                        onStep={(it, dir) => adjust.mutate({ item: it, delta: dir > 0 ? stepFor(it.unit) : -Math.min(stepFor(it.unit), it.qty ?? 0) })}
                        onEditQty={(it) => setEditingId(it.id)}
                        onSetStatus={(it, status) => setStatus.mutate({ item: it, status })}
                        onEditIcon={editIcon}
                        onAddToList={(it) =>
                          addToList.mutate(it, {
                            onSuccess: (list) => toast.show({ message: `${it.ingredient.name} added to ${list.title}` }),
                            onError: (error) => toast.error(errorMessage(error)),
                          })
                        }
                      />
                    ))}
                  </ul>
                </Card>
              ))
            )}
          </>
        )}
      </div>
      <SetQtySheet
        item={editing}
        onClose={() => setEditingId(null)}
        onSave={(item, changes) => {
          setQty.mutate({ item, qty: changes.qty });
          if (changes.expiresOn !== item.expiresOn) setExpiry.mutate({ item, expiresOn: changes.expiresOn });
          if (changes.category !== item.ingredient.category) {
            setCategory.mutate({ ingredientId: item.ingredient.id, category: changes.category });
          }
          if (changes.shelfLifeDays !== item.ingredient.shelfLifeDays) {
            setShelfLife.mutate({ ingredientId: item.ingredient.id, shelfLifeDays: changes.shelfLifeDays });
          }
        }}
        onEditIcon={editIcon}
        onRemove={(item) =>
          remove.mutate(
            { item },
            {
              onSuccess: () =>
                toast.show({
                  message: `${item.ingredient.name} removed from the pantry`,
                  action: {
                    label: "Undo",
                    onClick: () => restore.mutate({ item }, { onError: (error) => toast.error(errorMessage(error)) }),
                  },
                }),
              onError: (error) => toast.error(errorMessage(error)),
            },
          )
        }
      />
      <AddSheet
        open={adding}
        onClose={() => setAdding(false)}
        existing={items}
        initialName={query.trim()}
      />
      <IconPicker ingredient={iconIngredient} onClose={() => setIconIngredient(null)} />
      <SweepSheet open={sweeping} onClose={() => setSweeping(false)} items={items} />
    </>
  );
}
