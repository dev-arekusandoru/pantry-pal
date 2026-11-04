import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/api";
import { createAppRouter } from "@/app/router";
import { saveCookProgress } from "./progress";

interface Call {
  method: string;
  url: string;
  body: unknown;
}

const recipe = {
  id: "rec_skillet",
  householdId: "hh_test",
  title: "Chicken skillet",
  slug: "skillet",
  description: null,
  sourceUrl: null,
  sourceName: null,
  author: null,
  imageUrl: null,
  servings: 2,
  yieldText: null,
  prepMinutes: 5,
  cookMinutes: 15,
  totalMinutes: 20,
  spiceLevel: null,
  cuisine: null,
  mealTypes: ["dinner"],
  tags: [],
  equipment: [],
  nutrition: null,
  storageNotes: null,
  leftoverDays: null,
  status: "tried",
  rating: null,
  notes: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ingredients: [
    {
      id: "ri_1",
      householdId: "hh_test",
      recipeId: "rec_skillet",
      ingredientId: "ing_chicken",
      ingredient: { id: "ing_chicken", name: "chicken breast", category: "meat" },
      qty: 1,
      qtyMax: null,
      unit: "lb",
      prepNote: null,
      originalText: null,
      optional: false,
      scalingExempt: false,
      groupLabel: null,
    },
  ],
  steps: [
    { id: "step_1", text: "Chop the onion.", groupLabel: null, durationMinutes: null },
    { id: "step_2", text: "Simmer until done.", groupLabel: null, durationMinutes: null },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface StubRoute {
  method: string;
  /** Path suffix after /api/v1. */
  path: string | RegExp;
  status?: number;
  body: unknown;
}

/** Answer known routes; everything else is a 404. Records POST bodies. */
function stubApi(routes: StubRoute[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request) => {
      const url = new URL(input.url);
      const method = input.method.toUpperCase();
      const body = method === "POST" ? JSON.parse((await input.text()) || "null") : null;
      calls.push({ method, url: url.pathname + url.search, body });

      const path = url.pathname.replace(/^\/api\/v1/, "");
      for (const route of routes) {
        if (route.method !== method) continue;
        const matches = typeof route.path === "string" ? path === route.path : route.path.test(path);
        if (matches) return json(route.body, route.status ?? 200);
      }
      return json({ error: { code: "not_found", message: "Not found" } }, 404);
    }),
  );
  return calls;
}

function defaultRoutes(extra: StubRoute[] = []): StubRoute[] {
  return [
    { method: "GET", path: "/recipes/skillet", body: recipe },
    { method: "GET", path: /^\/recipes\/skillet\/scaled/, body: { items: [] } },
    { method: "GET", path: "/pantry/availability", body: { items: [] } },
    { method: "GET", path: "/cook-events", body: { items: [] } },
    ...extra,
  ];
}

async function renderAt(path: string, initialEntries?: string[]) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: initialEntries ?? [path] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("cook mode finishing", () => {
  it("falls back to an ad-hoc cook when the cook event in the URL no longer exists", async () => {
    const calls = stubApi(
      defaultRoutes([
        {
          method: "POST",
          path: "/cook-events/ce_gone/complete",
          status: 404,
          body: { error: { code: "not_found", message: "Cook event not found: ce_gone" } },
        },
        {
          method: "POST",
          path: "/cook-events",
          status: 201,
          body: {
            cookEvent: { id: "ce_new", status: "done", recipeTitle: recipe.title },
            movements: [],
            warnings: [],
          },
        },
      ]),
    );

    await renderAt("/recipes/skillet/cook?cookEvent=ce_gone&servings=2");

    await userEvent.click(await screen.findByRole("button", { name: "Next step" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish cooking" }));

    expect(await screen.findByRole("heading", { name: "Nice cooking!" })).toBeInTheDocument();

    const complete = calls.find((c) => c.method === "POST" && c.url.startsWith("/api/v1/cook-events/ce_gone/complete"));
    expect(complete).toBeDefined();
    const adhoc = calls.find(
      (c) => c.method === "POST" && c.url === "/api/v1/cook-events",
    );
    expect(adhoc?.body).toMatchObject({ recipeId: "rec_skillet", servings: 2, complete: true });
  });

  it("resumes saved progress at the saved step", async () => {
    stubApi(defaultRoutes());
    saveCookProgress("skillet", {
      step: 1,
      stepCount: 2,
      servings: 3,
      savedAt: "2026-11-02T12:00:00.000Z",
    });

    await renderAt("/recipes/skillet/cook");

    const sheet = await screen.findByRole("dialog", { name: "Pick up where you left off?" });
    expect(sheet).toHaveTextContent("step 2 of 2");
    await userEvent.click(screen.getByRole("button", { name: "Resume at step 2" }));

    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
  });

  it("offers resume from the recipe page", async () => {
    stubApi(defaultRoutes());
    saveCookProgress("skillet", {
      step: 1,
      stepCount: 2,
      servings: 2,
      savedAt: "2026-11-02T12:00:00.000Z",
    });

    await renderAt("/recipes/skillet");

    await userEvent.click(await screen.findByRole("link", { name: "Resume at step 2" }));
    expect(await screen.findByText("Step 2 of 2")).toBeInTheDocument();
  });
});

describe("leaving cook mode", () => {
  it("pops the cook route so back from the recipe returns to the originating page", async () => {
    stubApi(defaultRoutes());

    const router = await renderAt("/recipes/skillet", ["/", "/recipes/skillet"]);

    await userEvent.click(await screen.findByRole("link", { name: "Start cooking" }));
    expect(await screen.findByText("Step 1 of 2")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Exit cook mode" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/recipes/skillet"));

    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("does not stack a second recipe entry on finish", async () => {
    stubApi(
      defaultRoutes([
        {
          method: "POST",
          path: "/cook-events",
          status: 201,
          body: {
            cookEvent: { id: "ce_new", status: "done", recipeTitle: recipe.title },
            movements: [],
            warnings: [],
          },
        },
      ]),
    );

    const router = await renderAt("/recipes/skillet", ["/", "/recipes/skillet"]);

    await userEvent.click(await screen.findByRole("link", { name: "Start cooking" }));
    await userEvent.click(await screen.findByRole("button", { name: "Next step" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish cooking" }));
    expect(await screen.findByRole("heading", { name: "Nice cooking!" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back to the recipe" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/recipes/skillet"));

    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });
});
