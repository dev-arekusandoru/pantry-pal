/**
 * Query key convention
 * --------------------
 * Every key starts with a root from `qk`, which is the first path segment of the
 * resource in /api/v1. Screens append their own tail, so one invalidation by root
 * covers every variant:
 *
 *   useQuery({ queryKey: [...qk.pantry, "list", { location }], queryFn })
 *   queryClient.invalidateQueries({ queryKey: qk.pantry })      // all pantry queries
 *
 * Cross-screen effects use roots only (e.g. completing a shopping list invalidates
 * `qk.pantry`). Each screen keeps its own hooks in `screens/<name>/queries.ts`;
 * do not add screen-specific keys here.
 */
export const qk = {
  household: ["household"] as const,
  pantry: ["pantry"] as const,
  ingredients: ["ingredients"] as const,
  recipes: ["recipes"] as const,
  plans: ["plans"] as const,
  prepTasks: ["prep-tasks"] as const,
  cookEvents: ["cook-events"] as const,
  shoppingLists: ["shopping-lists"] as const,
  rules: ["rules"] as const,
};
