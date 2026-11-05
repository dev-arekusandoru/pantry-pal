import { useMemo, useRef, useState } from "react";
import { errorMessage } from "@/api";
import { Button, Card, EmptyState, ErrorState, Fab, Icon, PageHeader, SearchInput, Skeleton, cx, toast } from "@/ui";
import { AddSheet } from "./AddSheet";
import { ChoiceChips } from "./ChoiceChips";
import styles from "./Pantry.module.css";
import { useAdjustItem, usePantry, useRemoveItem, useRestoreItem, useSetQty, useSetStatus } from "./queries";
import { SetQtySheet } from "./SetQtySheet";
import { StockRow } from "./StockRow";
import { LOCATION_LABEL, LOCATION_ORDER, groupByLocation, stepFor, type PantryItem, type StorageLocation } from "./stock";

export function PantryScreen() {
  const pantry = usePantry();
  const adjust = useAdjustItem();
  const setQty = useSetQty();
  const setStatus = useSetStatus();
  const remove = useRemoveItem();
  const restore = useRestoreItem();
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState<StorageLocation | "all">("all");
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const [adding, setAdding] = useState(false);

  const items = pantry.data;
  const groups = useMemo(() => groupByLocation(items ?? [], query, location), [items, query, location]);
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

  // Only offer shelves that hold something; a filter that empties out falls back to everything.
  const present = LOCATION_ORDER.filter((l) => items.some((i) => i.location === l));
  const activeLocation = location === "all" || present.includes(location) ? location : "all";

  return (
    <>
      <div className={cx(styles.screen, sawLoading.current && styles.screenIn)} data-rows={sawLoading.current || undefined}>
        <PageHeader
          title="Pantry"
          sub={items.length === 0 ? "Nothing on the shelves yet" : `${items.length} ${items.length === 1 ? "thing" : "things"} on the shelves`}
        />
        {items.length === 0 ? (
          <EmptyState emoji="1FAD9" title="Your pantry is empty" action={addButton}>
            Add what you have and PantryPal can plan around it.
          </EmptyState>
        ) : (
          <>
            <div className={styles.tools}>
              <SearchInput label="Search the pantry" value={query} onChange={setQuery} />
              {present.length > 1 && (
                <ChoiceChips<StorageLocation | "all">
                  label="Filter by location"
                  value={activeLocation}
                  onChange={setLocation}
                  options={[{ value: "all", label: "Everything" }, ...present.map((l) => ({ value: l, label: LOCATION_LABEL[l] }))]}
                />
              )}
            </div>
            {groups.length === 0 ? (
              <EmptyState
                emoji="1F50E"
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
                <Card key={g.location} as="section" radius="xl" className={styles.shelf} data-loc={g.location} aria-label={LOCATION_LABEL[g.location]}>
                  <h2 className={styles.shelfName}>
                    {LOCATION_LABEL[g.location]}
                    <small>{g.items.length}</small>
                  </h2>
                  <ul>
                    {g.items.map((item) => (
                      <StockRow
                        key={item.id}
                        item={item}
                        onStep={(it, dir) => adjust.mutate({ item: it, delta: dir > 0 ? stepFor(it.unit) : -Math.min(stepFor(it.unit), it.qty ?? 0) })}
                        onEditQty={setEditing}
                        onSetStatus={(it, status) => setStatus.mutate({ item: it, status })}
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
        onClose={() => setEditing(null)}
        onSave={(item, qty) => setQty.mutate({ item, qty })}
        onRemove={(item) =>
          remove.mutate(
            { item },
            {
              onSuccess: () =>
                toast.show({
                  message: `${item.ingredient.name} removed from the ${LOCATION_LABEL[item.location].toLowerCase()} shelf`,
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
        initialLocation={activeLocation === "all" ? "pantry" : activeLocation}
      />
      <Fab label="Add to the pantry" onClick={() => setAdding(true)} />
    </>
  );
}
