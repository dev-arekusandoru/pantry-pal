import { useQuery } from "@tanstack/react-query";
import { client, qk, unwrap } from "@/api";

export type DoneCook = { recipeId: string; recipeTitle: string; cookDate: string };

/** Every finished cook, oldest first. Missions and the Dex are both derived from this; nothing is stored. */
export function useCookHistory() {
  return useQuery({
    queryKey: [...qk.cookEvents, "done-history"],
    queryFn: () => unwrap(client.GET("/cook-events", { params: { query: { status: "done" } } })),
    select: (data): DoneCook[] =>
      data.items
        .map(({ recipeId, recipeTitle, cookDate }) => ({ recipeId, recipeTitle, cookDate }))
        .sort((a, b) => a.cookDate.localeCompare(b.cookDate)),
  });
}
