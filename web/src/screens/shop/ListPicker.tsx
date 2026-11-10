import { useState } from "react";
import { Button, Icon, IconButton, Pill, Sheet } from "@/ui";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import type { ShoppingList } from "./cart";
import styles from "./Shop.module.css";

export interface ListPickerProps {
  open: boolean;
  onClose: () => void;
  /** Every list, open and done, newest first. */
  lists: readonly ShoppingList[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => Promise<void>;
  creating?: boolean;
  deleting?: boolean;
}

function madeOn(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusText(list: ShoppingList): string {
  if (list.status === "done") return "Done";
  return list.status === "shopping" ? "Shopping now" : "Draft";
}

export function ListPicker({ open, onClose, lists, selectedId, onSelect, onCreate, onDelete, creating, deleting }: ListPickerProps) {
  const [pendingDelete, setPendingDelete] = useState<ShoppingList | null>(null);
  const openLists = lists.filter((l) => l.status !== "done");
  const doneLists = lists.filter((l) => l.status === "done");

  const row = (list: ShoppingList) => (
    <li key={list.id} className={styles.pickItem}>
      <button
        type="button"
        className={styles.pickRow}
        aria-current={list.id === selectedId ? "true" : undefined}
        onClick={() => onSelect(list.id)}
      >
        <span className={styles.pickBody}>
          <span className={styles.pickTitle}>{list.title}</span>
          <span className={styles.pickSub}>
            {statusText(list)} · made {madeOn(list.createdAt)}
          </span>
        </span>
        {list.stale && <Pill tone="butter">Plan changed</Pill>}
        {list.id === selectedId && <Icon name="check" />}
      </button>
      <IconButton
        label={`Delete ${list.title}`}
        icon={<Icon name="trash" />}
        variant="plain"
        className={styles.pickDelete}
        onClick={() => setPendingDelete(list)}
      />
    </li>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Shopping lists"
      footer={
        <Button variant="primary" icon={<Icon name="plus" />} loading={creating} onClick={onCreate}>
          New list
        </Button>
      }
    >
      {lists.length === 0 ? (
        <p className={styles.sheetNote}>No lists yet. Make one to start shopping.</p>
      ) : (
        <div className={styles.pickGroups}>
          {openLists.length > 0 && (
            <section>
              <h3 className={styles.pickHead}>Open</h3>
              <ul className={styles.pickList}>{openLists.map(row)}</ul>
            </section>
          )}
          {doneLists.length > 0 && (
            <section>
              <h3 className={styles.pickHead}>Done</h3>
              <ul className={styles.pickList}>{doneLists.map(row)}</ul>
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this list?"
        confirmLabel="Delete list"
        cancelLabel="Keep the list"
        pending={deleting}
        onConfirm={() => {
          const id = pendingDelete?.id;
          if (id === undefined) return;
          void onDelete(id)
            .then(() => setPendingDelete(null))
            // The parent reports the error; keep the dialog open to retry.
            .catch(() => undefined);
        }}
      >
        {pendingDelete?.title} and its items will be removed. Purchases already added to the pantry stay.
      </ConfirmDialog>
    </Sheet>
  );
}
