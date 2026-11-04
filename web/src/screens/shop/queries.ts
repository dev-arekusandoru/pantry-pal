import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError, client, qk, unwrap } from "@/api";
import { cleared, setChecked, type ShoppingDetail } from "./cart";

const keys = {
  /** This week's plan as the shop screen needs it: id only, null when there is none. */
  plan: [...qk.plans, "shop-current"] as const,
  lists: [...qk.shoppingLists, "all"] as const,
  detail: (id: string) => [...qk.shoppingLists, "detail", id] as const,
  check: (id: string) => ["shop-check", id] as const,
};

export function useCurrentPlanId() {
  return useQuery({
    queryKey: keys.plan,
    queryFn: async (): Promise<string | null> => {
      try {
        const plan = await unwrap(client.GET("/plans/current"));
        return plan.id;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

/** Every list, newest first; the screen filters to open ones. */
export function useShoppingLists() {
  return useQuery({
    queryKey: keys.lists,
    queryFn: async () => (await unwrap(client.GET("/shopping-lists"))).items,
  });
}

export function useShoppingList(id: string | undefined) {
  return useQuery({
    queryKey: keys.detail(id ?? ""),
    queryFn: () => unwrap(client.GET("/shopping-lists/{id}", { params: { path: { id: id ?? "" } } })),
    enabled: id !== undefined,
  });
}

/** Optimistic check/uncheck. Rolls the one item back on failure; refetches when the last tap lands. */
export function useCheckItem(listId: string) {
  const qc = useQueryClient();
  const detailKey = keys.detail(listId);
  return useMutation({
    mutationKey: keys.check(listId),
    mutationFn: ({ itemId, checked }: { itemId: string; checked: boolean }) =>
      unwrap(
        client.POST("/shopping-lists/{id}/check", {
          params: { path: { id: listId } },
          body: { items: [{ itemId, checked }] },
        }),
      ),
    onMutate: async ({ itemId, checked }) => {
      await qc.cancelQueries({ queryKey: detailKey });
      const before = qc.getQueryData<ShoppingDetail>(detailKey)?.items.find((i) => i.id === itemId);
      qc.setQueryData<ShoppingDetail>(detailKey, (d) =>
        d && setChecked(d, itemId, checked ? new Date().toISOString() : null),
      );
      return { previousCheckedAt: before?.checkedAt ?? null };
    },
    onError: (_error, { itemId }, context) => {
      if (!context) return;
      qc.setQueryData<ShoppingDetail>(detailKey, (d) => d && setChecked(d, itemId, context.previousCheckedAt));
    },
    onSettled: () => {
      // Taps in flight would be overwritten by an early refetch; wait for the last one.
      if (qc.isMutating({ mutationKey: keys.check(listId) }) <= 1) {
        return qc.invalidateQueries({ queryKey: qk.shoppingLists });
      }
    },
  });
}

/** Optimistic clear: empties the detail at once, rolls back on failure, refetches when it lands. */
export function useClearList(listId: string) {
  const qc = useQueryClient();
  const detailKey = keys.detail(listId);
  return useMutation({
    mutationKey: ["shop-clear", listId] as const,
    mutationFn: () =>
      unwrap(client.DELETE("/shopping-lists/{id}/items", { params: { path: { id: listId } } })),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: detailKey });
      const previous = qc.getQueryData<ShoppingDetail>(detailKey);
      qc.setQueryData<ShoppingDetail>(detailKey, (d) => d && cleared(d));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(detailKey, context.previous);
    },
    onSuccess: (detail) => qc.setQueryData(detailKey, detail),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.shoppingLists }),
  });
}

export function useAddItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      unwrap(
        client.POST("/shopping-lists/{id}/items", {
          params: { path: { id: listId } },
          body: { items: [{ ingredient: name, name }] },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.shoppingLists }),
  });
}

function refreshAfterGenerate(qc: QueryClient, detail: ShoppingDetail) {
  qc.setQueryData(keys.detail(detail.list.id), detail);
  return qc.invalidateQueries({ queryKey: qk.shoppingLists });
}

/** New list from the plan, or (with `listId`) regenerate that list: generated unchecked items are replaced, the rest kept. */
export function useGenerateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mealPlanId, listId }: { mealPlanId: string; listId?: string }) =>
      unwrap(
        client.POST("/shopping-lists/generate", {
          body: { mealPlanId, ...(listId !== undefined ? { listId } : {}) },
        }),
      ),
    onSuccess: (detail) => refreshAfterGenerate(qc, detail),
  });
}

/** An empty manual list, for when there is no plan to generate from. */
export function useCreateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(client.POST("/shopping-lists", { body: { title: "Shopping list" } })),
    onSuccess: (detail) => refreshAfterGenerate(qc, detail),
  });
}

export interface ReceivedQty {
  itemId: string;
  qty: number;
}

/**
 * `onCompleted` runs as soon as the server confirms, before the refetch that turns the list "done":
 * the caller can pin the list in the URL first, so the screen doesn't jump to another list meanwhile.
 */
export function useCompleteList(listId: string, onCompleted: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (received: ReceivedQty[]) =>
      unwrap(
        client.POST("/shopping-lists/{id}/complete", {
          params: { path: { id: listId } },
          body: received.length > 0 ? { received } : {},
        }),
      ),
    onSuccess: () => {
      onCompleted();
      return Promise.all([qc.invalidateQueries({ queryKey: qk.pantry }), qc.invalidateQueries({ queryKey: qk.shoppingLists })]);
    },
  });
}
