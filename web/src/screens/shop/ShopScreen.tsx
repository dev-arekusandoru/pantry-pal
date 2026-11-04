import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, EmptyState, ErrorState, Icon, PageHeader, Skeleton, buttonClass } from "@/ui";
import { pickDefaultList } from "./cart";
import { ListPicker } from "./ListPicker";
import { ShopList } from "./ShopList";
import styles from "./Shop.module.css";
import { useCreateList, useCurrentPlanId, useGenerateList, useShoppingLists } from "./queries";

export interface ShopScreenProps {
  /** List named in the URL (`?list=`), if any. */
  listId: string | undefined;
  /** Put a list id in the URL (undefined clears it). */
  onSelectList: (id: string | undefined) => void;
}

export function ShopScreen({ listId, onSelectList }: ShopScreenProps) {
  const plan = useCurrentPlanId();
  const lists = useShoppingLists();
  const [pickerOpen, setPickerOpen] = useState(false);
  const generate = useGenerateList();
  const create = useCreateList();

  const error = lists.error ?? plan.error;
  if (error) {
    return (
      <>
        <PageHeader title="Shopping" />
        <ErrorState
          error={error}
          onRetry={() => {
            void lists.refetch();
            void plan.refetch();
          }}
        />
      </>
    );
  }
  if (!lists.data || plan.data === undefined) {
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

  const planId = plan.data;
  const open = lists.data.filter((l) => l.status !== "done");
  const selected = lists.data.find((l) => l.id === listId) ?? pickDefaultList(lists.data, planId);

  if (!selected) {
    const hasDoneThisWeek = planId !== null && lists.data.some((l) => l.mealPlanId === planId);
    return (
      <>
        <PageHeader title="Shopping" sub="Nothing on the list" />
        {planId !== null ? (
          <EmptyState
            emoji="1F6D2"
            title={hasDoneThisWeek ? "This week's shopping is done" : "No shopping list yet"}
            action={
              <Button
                variant="primary"
                size="lg"
                loading={generate.isPending}
                onClick={() =>
                  generate.mutate(
                    { mealPlanId: planId },
                    { onSuccess: (d) => onSelectList(d.list.id) },
                  )
                }
              >
                Make the shopping list
              </Button>
            }
          >
            {hasDoneThisWeek
              ? "Need more? Make a fresh list from this week's plan."
              : "We'll work out what this week's plan needs and leave out what you already have."}
          </EmptyState>
        ) : (
          <EmptyState
            emoji="1F9FA"
            title="No list, no plan"
            action={
              <>
                <Button variant="primary" size="lg" loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: (d) => onSelectList(d.list.id) })}>
                  Start a blank list
                </Button>
                <Link to="/" className={buttonClass({ variant: "ghost" })}>
                  Plan the week
                </Link>
              </>
            }
          >
            Plan the week and we'll build the list for you, or start a blank one and add things by hand.
          </EmptyState>
        )}
      </>
    );
  }

  return (
    <>
      <ShopList
        key={selected.id}
        list={selected}
        switcher={
          open.length > 1 || (selected.status === "done" && open.length > 0) ? (
            <div className={styles.switchRow}>
              <span className={styles.switchTitle}>{selected.title}</span>
              <Button variant="ghost" icon={<Icon name="list" />} onClick={() => setPickerOpen(true)}>
                Switch list
              </Button>
            </div>
          ) : null
        }
        onClose={() => onSelectList(undefined)}
        onCompleted={() => onSelectList(selected.id)}
      />
      <ListPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        lists={open}
        selectedId={selected.id}
        onSelect={(id) => {
          setPickerOpen(false);
          onSelectList(id);
        }}
      />
    </>
  );
}
