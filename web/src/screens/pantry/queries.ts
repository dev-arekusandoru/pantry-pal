import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, client, qk, unwrap } from "@/api";
import { toast } from "@/ui";
import { restoreBody, type PantryCategory, type PantryItem, type PantryStatus } from "./stock";

const listKey = [...qk.pantry, "list"] as const;
/** Every stock edit shares this key so the refetch waits for the last one in flight. */
const editKey = ["pantry-edit"] as const;

export function usePantry() {
  return useQuery({
    queryKey: listKey,
    queryFn: async () => (await unwrap(client.GET("/pantry"))).items,
  });
}

type Patch = (item: PantryItem) => PantryItem;

function useStockEdit<TVars, TResult>(options: {
  mutationFn: (vars: TVars) => Promise<TResult>;
  /** The item and how to show the edit before the server confirms. */
  optimistic: (vars: TVars) => { id: string; apply: Patch };
  /** Undo for one failed edit. Receives what `apply` saw. */
  undo: (vars: TVars, before: PantryItem | undefined) => Patch;
}) {
  const qc = useQueryClient();
  const patchItem = (id: string, fn: Patch) =>
    qc.setQueryData<PantryItem[]>(listKey, (items) => items?.map((i) => (i.id === id ? fn(i) : i)));
  return useMutation({
    mutationKey: editKey,
    mutationFn: options.mutationFn,
    onMutate: async (vars: TVars) => {
      await qc.cancelQueries({ queryKey: listKey });
      const { id, apply } = options.optimistic(vars);
      const before = qc.getQueryData<PantryItem[]>(listKey)?.find((i) => i.id === id);
      patchItem(id, apply);
      return { id, before };
    },
    onError: (_error, vars, ctx) => {
      if (ctx) patchItem(ctx.id, options.undo(vars, ctx.before));
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey: editKey }) <= 1) return qc.invalidateQueries({ queryKey: qk.pantry });
    },
  });
}

/** +/- on a measured item. Deltas commute, so rapid taps are safe. */
export function useAdjustItem() {
  return useStockEdit({
    mutationFn: ({ item, delta }: { item: PantryItem; delta: number }) =>
      unwrap(
        client.POST("/pantry/adjust", {
          body: { ingredientId: item.ingredientId, delta, unit: item.unit },
        }),
      ),
    optimistic: ({ item, delta }) => ({
      id: item.id,
      apply: (i) => {
        const qty = Math.max(0, (i.qty ?? 0) + delta);
        return { ...i, qty, status: qty === 0 ? "out" : i.status === "out" ? "on_hand" : i.status };
      },
    }),
    undo: ({ delta }) => (i) => ({ ...i, qty: Math.max(0, (i.qty ?? 0) - delta) }),
  });
}

/** Type in an exact amount. */
export function useSetQty() {
  return useStockEdit({
    mutationFn: ({ item, qty }: { item: PantryItem; qty: number }) =>
      unwrap(
        client.POST("/pantry/set", {
          body: { ingredientId: item.ingredientId, qty, unit: item.unit },
        }),
      ),
    optimistic: ({ item, qty }) => ({
      id: item.id,
      apply: (i) => ({ ...i, qty, status: qty === 0 ? "out" : i.status === "out" ? "on_hand" : i.status }),
    }),
    undo: (_vars, before) => (i) => (before ? { ...i, qty: before.qty, status: before.status } : i),
  });
}

/** Set or clear the expiry date of one pantry row. */
export function useSetExpiry() {
  return useStockEdit({
    mutationFn: ({ item, expiresOn }: { item: PantryItem; expiresOn: string | null }) =>
      unwrap(
        client.PATCH("/pantry/{id}", { params: { path: { id: item.id } }, body: { expiresOn } }),
      ),
    optimistic: ({ item, expiresOn }) => ({ id: item.id, apply: (i) => ({ ...i, expiresOn }) }),
    undo: (_vars, before) => (i) => (before ? { ...i, expiresOn: before.expiresOn } : i),
  });
}

/** Set or clear the ingredient's shelf life, used to date future purchases. */
export function useSetShelfLife() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ingredientId, shelfLifeDays }: { ingredientId: string; shelfLifeDays: number | null }) =>
      unwrap(
        client.PATCH("/ingredients/{id}", {
          params: { path: { id: ingredientId } },
          body: { shelfLifeDays },
        }),
      ),
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: qk.pantry }),
      qc.invalidateQueries({ queryKey: qk.ingredients }),
    ]),
  });
}

/** Change an ingredient's category, which decides the aisle it is grouped under. */
export function useSetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ingredientId, category }: { ingredientId: string; category: PantryCategory }) =>
      unwrap(
        client.PATCH("/ingredients/{id}", {
          params: { path: { id: ingredientId } },
          body: { category },
        }),
      ),
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: qk.pantry }),
      qc.invalidateQueries({ queryKey: qk.ingredients }),
    ]),
  });
}

/**
 * Add an ingredient to the default open list: this week's plan list, else the
 * newest open list, else a new manual list.
 */
export function useAddToList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: PantryItem) => {
      let planId: string | null = null;
      try {
        planId = (await unwrap(client.GET("/plans/current"))).id;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
      const lists = (await unwrap(client.GET("/shopping-lists"))).items;
      const open = lists.filter((l) => l.status !== "done");
      const list =
        (planId === null ? undefined : open.find((l) => l.mealPlanId === planId)) ??
        open[0] ??
        (await unwrap(client.POST("/shopping-lists", { body: { title: "Shopping list" } }))).list;
      const added = await unwrap(
        client.POST("/shopping-lists/{id}/items", {
          params: { path: { id: list.id } },
          body: { items: [{ ingredientId: item.ingredientId }] },
        }),
      );
      return { list, itemId: added.items[0]?.id ?? null };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.shoppingLists }),
  });
}

/** Take back one list item, for example the one a sweep answer just added. */
export function useRemoveListItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, itemId }: { listId: string; itemId: string }) =>
      unwrap(client.DELETE("/shopping-lists/{id}/items/{itemId}", { params: { path: { id: listId, itemId } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.shoppingLists }),
  });
}

/** On hand / running low / out for items without a quantity. */
export function useSetStatus() {
  return useStockEdit({
    mutationFn: ({ item, status }: { item: PantryItem; status: PantryStatus }) =>
      unwrap(client.PATCH("/pantry/{id}", { params: { path: { id: item.id } }, body: { status } })),
    optimistic: ({ item, status }) => ({ id: item.id, apply: (i) => ({ ...i, status }) }),
    undo: (_vars, before) => (i) => (before ? { ...i, status: before.status } : i),
  });
}

export interface NewStock {
  name: string;
  category: PantryCategory;
  /** Amount to add; null = just note that we have it. */
  qty: number | null;
  unit: string | null;
}

/**
 * Quick add. With an amount it adds to whatever is already there (and creates the ingredient if it is new);
 * without one it records "on hand" for an unmeasured item.
 */
export function useAddStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (n: NewStock) => {
      const result =
        n.qty !== null
          ? await unwrap(
              client.POST("/pantry/adjust", {
                body: { ingredient: n.name, category: n.category, delta: n.qty, unit: n.unit },
              }),
            )
          : await unwrap(
              client.POST("/pantry/set", {
                body: { ingredient: n.name, category: n.category, qty: null, status: "on_hand" },
              }),
            );
      if (result.warning) toast.show({ message: `Added, but ${result.warning}` });
      return result;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.pantry }),
  });
}

/**
 * Remove a pantry row entirely (its movement history goes with it, since the row
 * is the ledger subject). The list drops the row at once and rolls back on failure.
 */
export function useRemoveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: editKey,
    mutationFn: ({ item }: { item: PantryItem }) =>
      unwrap(client.DELETE("/pantry/{id}", { params: { path: { id: item.id } } })),
    onMutate: async ({ item }) => {
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<PantryItem[]>(listKey);
      qc.setQueryData<PantryItem[]>(listKey, (items) => items?.filter((i) => i.id !== item.id));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(listKey, context.previous);
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey: editKey }) <= 1) return qc.invalidateQueries({ queryKey: qk.pantry });
    },
  });
}

/** Undo for a removal: re-adds the row where it was with its previous amount. */
export function useRestoreItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: editKey,
    mutationFn: ({ item }: { item: PantryItem }) => unwrap(client.POST("/pantry/set", { body: restoreBody(item) })),
    onSettled: () => {
      if (qc.isMutating({ mutationKey: editKey }) <= 1) return qc.invalidateQueries({ queryKey: qk.pantry });
    },
  });
}

/** "Still have it": stamps the row as checked now, without changing the amount. */
export function useVerifyItem() {
  return useStockEdit({
    mutationFn: (item: PantryItem) => unwrap(client.POST("/pantry/{id}/verify", { params: { path: { id: item.id } } })),
    optimistic: (item) => ({ id: item.id, apply: (i) => ({ ...i, lastVerifiedAt: new Date().toISOString() }) }),
    undo: (_item, before) => (i) => (before ? { ...i, lastVerifiedAt: before.lastVerifiedAt } : i),
  });
}
