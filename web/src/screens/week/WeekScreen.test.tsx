import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connection } from "@/api";
import { localToday, weekRange, weekStartFor } from "./dates";
import { WeekScreen } from "./WeekScreen";

afterEach(() => {
  vi.unstubAllGlobals();
  connection.markReachable();
});

/** Answer every request by URL; a handler may throw to simulate an unreachable server. */
function stubFetch(handler: (url: string) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => handler(req.url)),
  );
}

const notFound = () =>
  Response.json({ error: { code: "not_found", message: "Plan not found" } }, { status: 404 });

function renderWeek() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WeekScreen onSelectWeek={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("WeekScreen household settings robustness", () => {
  it("renders the current week when a stale API answers without settings", async () => {
    stubFetch((url) => {
      if (url.includes("/household")) {
        // Old server shape: flat fields, no `settings` object at all.
        return Response.json({ id: "hh_1", name: "Old", timezone: "UTC", weekStart: 0, themeDefault: "system" });
      }
      if (url.includes("/recipes")) return Response.json({ items: [], total: 0, limit: 200, offset: 0 });
      if (url.includes("/prep-tasks")) return Response.json({ items: [] });
      return notFound(); // no plan for the week
    });
    renderWeek();
    expect(await screen.findByRole("heading", { name: "This week" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous week" })).toBeInTheDocument();
    // Monday-based week label despite the stale server's `weekStart: 0`.
    expect(screen.getByText(weekRange(weekStartFor(localToday(), 1)))).toBeInTheDocument();
  });

  it("shows the unreachable ErrorState instead of crashing when the API is down", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    renderWeek();
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach PantryPal");
  });
});
