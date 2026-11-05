import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setTheme } from "@/app/theme";
import { SettingsScreen } from "./SettingsScreen";

afterEach(() => {
  vi.unstubAllGlobals();
  setTheme("system");
});

/** Household fetch plus the public health endpoint the footer reads. */
function stubSettingsApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      if (req.url.includes("/household")) {
        return Response.json({
          id: "hh_1",
          name: "Test House",
          timezone: "Europe/Berlin",
          settings: {
            defaultServings: 2,
            spiceLevel: "medium",
            lunchBatchServings: 3,
            dinnerServings: 4,
            weekStartsOn: 1,
            unitSystem: "metric",
            planningNotes: null,
          },
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        });
      }
      return Response.json({ version: "1.2.3" });
    }),
  );
}

async function renderSettings() {
  stubSettingsApi();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <SettingsScreen />
    </QueryClientProvider>,
  );
  await screen.findByRole("radiogroup", { name: "Theme" });
  return view;
}

describe("SettingsScreen", () => {
  it("exposes the theme as a radio group and applies the choice", async () => {
    await renderSettings();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Match device" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Match device" })).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("associates the household name label and separates the servings rows", async () => {
    const { container } = await renderSettings();
    expect(screen.getByLabelText("Household name")).toHaveValue("Test House");
    // Decorative separators between the three servings rows.
    expect(container.querySelectorAll('[role="none"]')).toHaveLength(2);
  });
});
