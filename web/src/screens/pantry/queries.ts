import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, qk, unwrap } from "@/api";
import { toast } from "@/ui";
import type { PantryItem, PantryStatus, StorageLocation } from "./stock";

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
          body: { ingredientId: item.ingredientId, location: item.location, delta, unit: item.unit },
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
          body: { ingredientId: item.ingredientId, location: item.location, qty, unit: item.unit },
        }),
      ),
    optimistic: ({ item, qty }) => ({
      id: item.id,
      apply: (i) => ({ ...i, qty, status: qty === 0 ? "out" : i.status === "out" ? "on_hand" : i.status }),
    }),
    undo: (_vars, before) => (i) => (before ? { ...i, qty: before.qty, status: before.status } : i),
  });
}

/** On hand / running low / out for staples without a quantity. */
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
  category: PantryItem["ingredient"]["category"];
  location: StorageLocation;
  /** Amount to add; null = just note that we have it. */
  qty: number | null;
  unit: string | null;
}

/**
 * Quick add. With an amount it adds to whatever is already there (and creates the ingredient if it is new);
 * without one it records "on hand" for an unmeasured staple.
 */
export function useAddStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (n: NewStock) => {
      const result =
        n.qty !== null
          ? await unwrap(
              client.POST("/pantry/adjust", {
                body: { ingredient: n.name, category: n.category, location: n.location, delta: n.qty, unit: n.unit },
              }),
            )
          : await unwrap(
              client.POST("/pantry/set", {
                body: { ingredient: n.name, category: n.category, location: n.location, qty: null, status: "on_hand" },
              }),
            );
      if (result.warning) toast.show({ message: `Added, but ${result.warning}` });
      return result;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.pantry }),
  });
}
