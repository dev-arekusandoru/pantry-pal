import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setTheme } from "@/app/theme";
import { SettingsScreen } from "./SettingsScreen";
import type { HouseholdMember } from "./queries";

afterEach(() => {
  vi.unstubAllGlobals();
  setTheme("system");
});

const HOUSEHOLD = {
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
};

function makeMember(id: string, name: string): HouseholdMember {
  return {
    id,
    householdId: "hh_1",
    name,
    notes: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

/** Household, its people, and the public health endpoint the footer reads. */
function stubSettingsApi() {
  const members = [makeMember("m_1", "Ada")];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const path = new URL(req.url, "http://localhost").pathname;
      if (path.endsWith("/household")) return Response.json(HOUSEHOLD);

      if (path.endsWith("/household/members")) {
        if (req.method === "GET") return Response.json({ items: members });
        if (req.method === "POST") {
          const { name } = (await req.json()) as { name: string };
          const created = makeMember(`m_${members.length + 1}`, name);
          members.push(created);
          return Response.json(created, { status: 201 });
        }
      }

      const byId = path.match(/\/household\/members\/([^/]+)$/);
      if (byId) {
        const index = members.findIndex((member) => member.id === byId[1]);
        const member = index === -1 ? undefined : members[index];
        if (member) {
          if (req.method === "PATCH") {
            const { name } = (await req.json()) as { name: string };
            const updated = { ...member, name };
            members.splice(index, 1, updated);
            return Response.json(updated);
          }
          if (req.method === "DELETE") {
            members.splice(index, 1);
            return Response.json({ deleted: true, id: member.id });
          }
        }
      }

      return Response.json({ version: "1.2.3" });
    }),
  );

  return members;
}

async function renderSettings() {
  const members = stubSettingsApi();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <SettingsScreen />
    </QueryClientProvider>,
  );
  await screen.findByRole("radiogroup", { name: "Theme" });
  await screen.findByLabelText("Name for Ada");
  return { ...view, members };
}

describe("SettingsScreen", () => {
  it("exposes the theme as a radio group and applies the choice", async () => {
    await renderSettings();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");

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

  it("adds a person and clears the field", async () => {
    const user = userEvent.setup();
    const { members } = await renderSettings();
    const input = screen.getByLabelText("Name");

    await user.type(input, "  Babbage  ");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByLabelText("Name for Babbage")).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(members.map((member) => member.name)).toEqual(["Ada", "Babbage"]);
  });

  it("renames a person on Enter and ignores an empty draft", async () => {
    const user = userEvent.setup();
    const { members } = await renderSettings();
    const input = screen.getByLabelText("Name for Ada");

    await user.clear(input);
    await user.type(input, "Ada Lovelace{Enter}");
    expect(await screen.findByLabelText("Name for Ada Lovelace")).toBeInTheDocument();
    expect(members[0]?.name).toBe("Ada Lovelace");

    const renamed = screen.getByLabelText("Name for Ada Lovelace");
    await user.clear(renamed);
    await user.tab();
    await waitFor(() => expect(renamed).toHaveValue("Ada Lovelace"));
    expect(members[0]?.name).toBe("Ada Lovelace");
  });

  it("confirms removal before dropping a person", async () => {
    const user = userEvent.setup();
    const { members } = await renderSettings();

    await user.click(screen.getByRole("button", { name: "Remove Ada" }));
    expect(screen.getByRole("dialog", { name: "Remove Ada?" })).toBeInTheDocument();
    expect(screen.getByText("Dietary rules for Ada are removed too.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByLabelText("Name for Ada")).not.toBeInTheDocument());
    expect(members).toHaveLength(0);
  });
});
