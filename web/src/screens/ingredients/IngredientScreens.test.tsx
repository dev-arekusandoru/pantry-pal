import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "@/app/router";

afterEach(() => vi.unstubAllGlobals());

const NOW = "2026-01-01T00:00:00Z";

function view(id: string, name: string, category: string, fdcId: number | null) {
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    description: null,
    category,
    stockUnit: null,
    imageUrl: null,
    shelfLifeDays: null,
    parQty: null,
    notes: null,
    defaultPortion: null,
    needsReview: fdcId === null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    nutrition: fdcId === null ? null : { source: "manual", fdcId, description: "Eggs, raw", per100g: null, portions: [] },
    aliases: [],
    measures: [],
    units: ["count", "g", "oz", "cup"],
    pantry: [],
  };
}

const PASTE = view("ing_paste", "Birria Paste", "condiment", null);
const EGG = view("ing_egg", "Egg", "protein", 1);

/** Library, attention list, usage counts and one detail page with a PATCH that can fail. */
function stubApi(options: { patchError?: { status: number; body: unknown } } = {}) {
  const patches: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const path = new URL(req.url, "http://localhost").pathname.replace("/api/v1", "");
      if (path === "/ingredients/review") {
        return Response.json({
          items: [{ ingredient: PASTE, reasons: ["unlinked", "custom_unreviewed"], suggestions: [] }],
        });
      }
      if (path === "/ingredients/usage") {
        return Response.json({ items: [{ ingredientId: EGG.id, recipes: 1, pantry: 0, shopping: 0, rules: 0 }] });
      }
      if (path === "/ingredients" && req.method === "GET") return Response.json({ items: [PASTE, EGG] });
      if (path === `/ingredients/${PASTE.id}`) {
        if (req.method === "PATCH") {
          patches.push(await req.json());
          if (options.patchError) return Response.json(options.patchError.body, { status: options.patchError.status });
          return Response.json({ ...PASTE, name: "Smoked Birria Paste" });
        }
        return Response.json({
          ...PASTE,
          usage: {
            recipes: [{ id: "rec_1", slug: "birria-tacos", title: "Birria Tacos", lines: 1, asMain: 1, asAlternative: 0 }],
            pantryItem: null,
            shoppingItems: [],
            rules: [],
          },
          review: { reasons: ["unlinked", "custom_unreviewed"], suggestions: [] },
        });
      }
      return Response.json({});
    }),
  );
  return patches;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("ingredient library", () => {
  it("lists ingredients by aisle with filter chips and counts", async () => {
    stubApi();
    const user = userEvent.setup();
    renderAt("/ingredients");

    expect(await screen.findByRole("heading", { level: 1, name: "Ingredients" })).toBeInTheDocument();
    const egg = await screen.findByRole("link", { name: /Egg/ });
    expect(egg).toHaveAttribute("href", "/ingredients/ing_egg");
    expect(screen.getByRole("heading", { level: 2, name: /Condiments/ })).toBeInTheDocument();

    expect(screen.getByRole("radio", { name: "All (2)" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Needs attention (1)" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: /Egg/ })).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Birria Paste/ })).toBeInTheDocument();
  });

  it("redirects the old review screen to Needs attention", async () => {
    stubApi();
    const router = renderAt("/ingredients/review");
    expect(await screen.findByRole("radio", { name: "Needs attention (1)" })).toHaveAttribute("aria-checked", "true");
    expect(router.state.location.pathname).toBe("/ingredients");
    expect(router.state.location.search).toEqual({ filter: "attention" });
    expect(screen.queryByRole("link", { name: /Egg/ })).not.toBeInTheDocument();
  });
});

describe("ingredient page", () => {
  it("shows attention reasons, usage links and saves a rename", async () => {
    const patches = stubApi();
    const user = userEvent.setup();
    renderAt(`/ingredients/${PASTE.id}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Birria Paste" })).toBeInTheDocument();
    const attention = screen.getByRole("region", { name: "Needs attention" });
    expect(within(attention).getByText("No USDA food")).toBeInTheDocument();
    expect(within(attention).getByRole("button", { name: "Keep as custom" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Birria Tacos/ })).toHaveAttribute("href", "/recipes/birria-tacos");

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "smoked birria paste");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(patches).toEqual([{ name: "smoked birria paste" }]));
    expect(await screen.findByText("Saved Smoked Birria Paste.")).toBeInTheDocument();
    expect(name).toHaveValue("Smoked Birria Paste");
  });

  it("shows a naming problem next to the name field", async () => {
    stubApi({
      patchError: {
        status: 422,
        body: {
          error: {
            code: "unprocessable",
            message: "Invalid ingredient name",
            details: { reason: 'contains "or"', hint: "Use the main ingredient and add the others as alternatives." },
          },
        },
      },
    });
    const user = userEvent.setup();
    renderAt(`/ingredients/${PASTE.id}`);

    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "milk or water");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/Contains "or"/)).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveFocus();
  });
});
