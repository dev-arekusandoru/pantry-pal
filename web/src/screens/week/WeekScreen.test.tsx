import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connection } from "@/api";
import { localToday, weekRange, weekStartFor } from "./dates";
import { WeekScreen } from "./WeekScreen";

afterEach(() => {
  vi.unstubAllGlobals();
  connection.markReachable();
});

/** Answer every request by URL; a handler may throw to simulate an unreachable server. */
function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => handler(req.url)),
  );
}

const notFound = () =>
  Response.json({ error: { code: "not_found", message: "Plan not found" } }, { status: 404 });

interface RenderWeekProps {
  week?: string;
  onSelectWeek?: (weekStart: string | null) => void;
}

function renderWeek(props: RenderWeekProps = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (next: RenderWeekProps) => (
    <QueryClientProvider client={client}>
      <WeekScreen week={next.week} onSelectWeek={next.onSelectWeek ?? vi.fn()} />
    </QueryClientProvider>
  );
  const view = render(ui(props));
  return { ...view, rerenderWeek: (next: RenderWeekProps) => view.rerender(ui(next)) };
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

  it("keeps the previous week mounted while the next one loads", async () => {
    // Far enough ahead that it is never the current week, whenever the suite runs.
    const nextWeek = "2027-06-07";
    stubFetch((url) => {
      if (url.includes("/household")) {
        return Response.json({ id: "hh_1", name: "Old", timezone: "UTC", weekStart: 0, themeDefault: "system" });
      }
      if (url.includes("/recipes")) return Response.json({ items: [], total: 0, limit: 200, offset: 0 });
      if (url.includes("/prep-tasks")) return Response.json({ items: [] });
      if (url.includes("/plans/")) {
        const weekStart = decodeURIComponent(url.slice(url.indexOf("/plans/") + "/plans/".length).split("?")[0] ?? "");
        // The target week never answers: that window is what the test looks at.
        if (weekStart === nextWeek) return new Promise<Response>(() => {});
        return Response.json({
          id: `plan_${weekStart}`,
          householdId: "hh_1",
          weekStart,
          title: null,
          status: "active",
          notes: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          days: [],
          cookEvents: [],
          prepTasks: [],
          warnings: [],
        });
      }
      return notFound();
    });

    const view = renderWeek();
    await waitFor(() => expect(screen.queryByText(/Loading the week/)).toBeNull());

    view.rerenderWeek({ week: nextWeek });

    // No skeleton swap: the last week's block stays up, so the page keeps its
    // height and the scroll position is never clamped.
    expect(screen.queryByText(/Loading the week/)).toBeNull();
    expect(document.querySelector("[data-updating]")).not.toBeNull();
  });
});
