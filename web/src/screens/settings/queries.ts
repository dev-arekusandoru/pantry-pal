import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, qk, unwrap } from "@/api";
import type { paths } from "@/api";

export type Household = paths["/household"]["get"]["responses"][200]["content"]["application/json"];
export type HouseholdSettings = Household["settings"];

export interface HouseholdPatch {
  name?: string;
  settings?: Partial<HouseholdSettings>;
}

const UPDATE_KEY = [...qk.household, "update"] as const;

export function householdQueryOptions() {
  return {
    queryKey: qk.household,
    queryFn: () => unwrap(client.GET("/household")),
    staleTime: 5 * 60_000,
  };
}

export function useHousehold() {
  return useQuery(householdQueryOptions());
}

/**
 * Patches the household (settings merge key-by-key on the server). The cache is
 * updated optimistically so steppers feel instant; patches run one at a time so
 * rapid taps land in order, and the server copy is refetched once they settle.
 */
export function useUpdateHousehold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: UPDATE_KEY,
    scope: { id: "household-update" },
    mutationFn: (patch: HouseholdPatch) => unwrap(client.PATCH("/household", { body: patch })),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: qk.household });
      const previous = queryClient.getQueryData<Household>(qk.household);
      if (previous) {
        queryClient.setQueryData<Household>(qk.household, {
          ...previous,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          settings: { ...previous.settings, ...patch.settings },
        });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(qk.household, context.previous);
    },
    onSettled: () => {
      // This mutation still counts as in flight here; only refetch after the last one.
      if (queryClient.isMutating({ mutationKey: UPDATE_KEY }) <= 1) {
        void queryClient.invalidateQueries({ queryKey: qk.household });
      }
    },
  });
}

/** Server version from the public /health endpoint (outside /api/v1, so plain fetch). */
export function useServerVersion() {
  return useQuery({
    queryKey: ["health"],
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<string | null> => {
      const res = await fetch("/health");
      if (!res.ok) return null;
      const body: unknown = await res.json().catch(() => null);
      const version = (body as { version?: unknown } | null)?.version;
      return typeof version === "string" ? version : null;
    },
  });
}
