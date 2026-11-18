import { Link } from "@tanstack/react-router";
import { errorMessage } from "@/api";
import { useState } from "react";
import { useHousehold, weekStartsOnOf } from "@/screens/settings/queries";
import { addDays, localToday, weekRange, weekStartFor } from "@/screens/week/dates";
import { usePlan } from "@/screens/week/queries";
import { Button, EmptyState, ErrorState, Icon, PageHeader, Sheet, Skeleton, buttonClass, toast } from "@/ui";
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
  const household = useHousehold();
  const thisWeek = weekStartFor(localToday(), weekStartsOnOf(household.data));
  const nextPlan = usePlan(addDays(thisWeek, 7));
  const [weekOpen, setWeekOpen] = useState(false);
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
  if (!lists.data || plan.data === undefined || nextPlan.isPending) {
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
  const nextPlanId = nextPlan.data?.id ?? null;
  // On a weekend the list you shop for is often next week's, so fall back to it.
  const selected =
    lists.data.find((l) => l.id === listId) ??
    pickDefaultList(lists.data, planId) ??
    (nextPlanId ? pickDefaultList(lists.data, nextPlanId) : undefined);
  const nextWeek = addDays(thisWeek, 7);
  const targets = [
    ...(planId ? [{ id: planId, label: `This week (${weekRange(thisWeek)})` }] : []),
    ...(nextPlanId ? [{ id: nextPlanId, label: `Next week (${weekRange(nextWeek)})` }] : []),
  ];

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
        {targets.length > 0 ? (
          <EmptyState
            emoji="tomato"
            title="No shopping list yet"
            action={
              <>
                <Button variant="primary" size="lg" onClick={() => setWeekOpen(true)}>
                  Generate shopping list
                </Button>
                {lists.data.length > 0 && (
                  <Button variant="ghost" icon={<Icon name="list" />} onClick={() => setPickerOpen(true)}>
                    All lists
                  </Button>
                )}
              </>
            }
          >
            We'll work out what the plan needs and leave out what you already have.
          </EmptyState>
        ) : (
          <EmptyState
            emoji="bell-peppers"
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
        <Sheet open={weekOpen} onClose={() => setWeekOpen(false)} title="Which week?">
          <div className={styles.addForm}>
            {targets.map((t) => (
              <Button
                key={t.id}
                size="lg"
                loading={generate.isPending && generate.variables?.mealPlanId === t.id}
                disabled={generate.isPending}
                onClick={() =>
                  generate.mutate(
                    { mealPlanId: t.id },
                    {
                      onSuccess: (d) => {
                        setWeekOpen(false);
                        onSelectList(d.list.id);
                      },
                    },
                  )
                }
              >
                {t.label}
              </Button>
            ))}
          </div>
        </Sheet>
      </>
    );
  }

  return (
    <>
      <ShopList
        key={selected.id}
        list={selected}
        onOpenLists={() => setPickerOpen(true)}
        onClose={() => onSelectList(undefined)}
        onCompleted={() => onSelectList(selected.id)}
      />
      {picker}
    </>
  );
}
