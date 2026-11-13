import { useQueries, useQuery } from "@tanstack/react-query";
import { client, qk, unwrap } from "@/api";
import { useCookHistory } from "@/game/history";
import { aggregateDex } from "./dex";
import type { DexIngredient, DexRecipe } from "./dex";

export function useDex() {
  const history = useCookHistory();
  const recipeIds = [...new Set(history.data?.map((cook) => cook.recipeId) ?? [])];
  const recipes = useQueries({ queries: recipeIds.map((id) => ({
    queryKey: [...qk.recipes, "detail", id],
    queryFn: () => unwrap(client.GET("/recipes/{idOrSlug}", { params: { path: { idOrSlug: id } } })) as Promise<DexRecipe>,
    staleTime: 30 * 60_000,
  })) });
  const catalog = useQuery({ queryKey: [...qk.ingredients, "dex-catalog"], queryFn: async (): Promise<DexIngredient[]> => (await unwrap(client.GET("/ingredients"))).items, staleTime: 30 * 60_000 });
  const loading = history.isLoading || (history.data !== undefined && recipes.some((r) => r.isLoading)) || catalog.isLoading;
  const error = history.error ?? recipes.find((r) => r.error)?.error ?? catalog.error;
  return { data: history.data && catalog.data ? { entries: aggregateDex(catalog.data, history.data, recipes.flatMap((r) => r.data ? [r.data] : [])), catalog: catalog.data } : undefined, isLoading: loading, error, refetch: () => { void history.refetch(); void catalog.refetch(); recipes.forEach((r) => void r.refetch()); } };
}
