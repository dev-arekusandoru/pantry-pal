import { Link } from "@tanstack/react-router";
import { errorMessage } from "@/api";
import { useState } from "react";
import { Button, EmptyState, ErrorState, Icon, PageHeader, Skeleton, buttonClass, toast } from "@/ui";
import { pickDefaultList } from "./cart";
import { ListPicker } from "./ListPicker";
import { ShopList } from "./ShopList";
import styles from "./Shop.module.css";
import { useCreateList, useCurrentPlanId, useDeleteList, useGenerateList, useShoppingLists } from "./queries";

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
  const remove = useDeleteList();

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
  const selected = lists.data.find((l) => l.id === listId) ?? pickDefaultList(lists.data, planId);

  const picker = (
    <ListPicker
      open={pickerOpen}
      onClose={() => setPickerOpen(false)}
      lists={lists.data}
      selectedId={selected?.id ?? ""}
      onSelect={(id) => {
        setPickerOpen(false);
        onSelectList(id);
      }}
      onCreate={() =>
        create.mutate(undefined, {
          onSuccess: (d) => {
            setPickerOpen(false);
            onSelectList(d.list.id);
          },
        })
      }
      onDelete={async (id) => {
        try {
          await remove.mutateAsync(id);
          if (id === selected?.id) onSelectList(undefined);
        } catch (error) {
          toast.error(errorMessage(error));
          throw error;
        }
      }}
      creating={create.isPending}
      deleting={remove.isPending}
    />
  );

  if (!selected) {
    return (
      <>
        <PageHeader title="Shopping" sub="Nothing on the list" />
        {planId !== null ? (
          <EmptyState
            emoji="1F6D2"
            title="No shopping list yet"
            action={
              <>
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
                {lists.data.length > 0 && (
                  <Button variant="ghost" icon={<Icon name="list" />} onClick={() => setPickerOpen(true)}>
                    All lists
                  </Button>
                )}
              </>
            }
          >
            We'll work out what this week's plan needs and leave out what you already have.
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
        {picker}
      </>
    );
  }

  return (
    <>
      <ShopList
        key={selected.id}
        list={selected}
        switcher={
          <div className={styles.switchRow}>
            <span className={styles.switchTitle}>{selected.title}</span>
            <Button variant="ghost" icon={<Icon name="list" />} onClick={() => setPickerOpen(true)}>
              All lists
            </Button>
          </div>
        }
        onClose={() => onSelectList(undefined)}
        onCompleted={() => onSelectList(selected.id)}
      />
      {picker}
    </>
  );
}
