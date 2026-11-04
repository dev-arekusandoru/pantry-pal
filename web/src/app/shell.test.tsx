import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../api";
import { createAppRouter } from "./router";

async function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/** Recipe screens fetch on mount; answer every request with a 404 so they settle on "not found". */
function stubRecipeNotFound() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: { code: "not_found", message: "Recipe not found" } }), { status: 404, headers: { "content-type": "application/json" } })),
  );
}

afterEach(() => vi.unstubAllGlobals());
describe("app shell", () => {
  it("renders the five-tab nav with the active tab marked", async () => {
    await renderAt("/shop");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    for (const name of ["Week", "Shop", "Pantry", "Recipes", "Settings"]) {
      expect(nav).toHaveTextContent(name);
    }
    expect(screen.getByRole("link", { name: "Shop" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("heading", { name: "Shopping" })).toBeInTheDocument();
  });

  it("keeps the Recipes tab active on a recipe page", async () => {
    stubRecipeNotFound();
    await renderAt("/recipes/slow-cooker-chili");
    expect(await screen.findByRole("heading", { name: "Recipe not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Recipes" })).toHaveAttribute("aria-current", "page");
  });

  it("cook mode has no nav", async () => {
    stubRecipeNotFound();
    await renderAt("/recipes/slow-cooker-chili/cook?cookEvent=abc&servings=3");
    expect(await screen.findByRole("heading", { name: "Recipe not found" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });
});
