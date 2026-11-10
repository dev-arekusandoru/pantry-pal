import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, qk, unwrap, type components } from "@/api";

/** Payload the editor sends; `links` reference lines by index in `ingredients`. */
export interface RecipeSaveInput {
  title: string;
  servings?: number;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  totalMinutes?: number | null;
  mealTypes: components["schemas"]["MealType"][];
  tags: string[];
  equipment: string[];
  notes: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  ingredients: Array<{
    ingredient: string;
    qty: number | null;
    qtyMax: number | null;
    unit: string | null;
    prepNote: string | null;
    optional: boolean;
    scalingExempt: boolean;
    groupLabel: string | null;
  }>;
  steps: Array<{
    text: string;
    durationMinutes: number | null;
    groupLabel: string | null;
    links: Array<{ ingredientIndex: number; qty: number | null }>;
  }>;
}

// The generated schema knows `links` and `cookEventCount`; no local cast needed.

export function useCreateRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecipeSaveInput) =>
      unwrap(client.POST("/recipes", { body: input })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.recipes }),
  });
}

export function useUpdateRecipe(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecipeSaveInput) =>
      unwrap(
        client.PATCH("/recipes/{idOrSlug}", {
          params: { path: { idOrSlug: slug } },
          body: input,
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.recipes }),
  });
}

/** Tags used by the household's recipes, for the editor's suggestions. */
export function useTagSuggestions() {
  return useQuery({
    queryKey: [...qk.recipes, "tag-suggestions"],
    queryFn: () => unwrap(client.GET("/recipes", { params: { query: { limit: 200 } } })),
    select: (d) => [...new Set(d.items.flatMap((recipe) => recipe.tags))].sort((a, b) => a.localeCompare(b)),
  });
}
