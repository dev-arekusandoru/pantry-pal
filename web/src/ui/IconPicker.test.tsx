import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconPicker } from "./IconPicker";

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function renderPicker(imageUrl: string | null = null) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      calls.push({
        method: request.method,
        url: request.url,
        body: request.method === "GET" ? null : await request.clone().json(),
      });
      return Response.json({});
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <IconPicker
        ingredient={{ id: "ing_1", name: "Mystery powder", imageUrl }}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
  return { calls, view };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IconPicker", () => {
  it("filters icons by a humanised name and patches the chosen one", async () => {
    const user = userEvent.setup();
    const { calls } = renderPicker();
    await user.type(screen.getByRole("searchbox", { name: "Search icons" }), "olive o");
    await user.click(await screen.findByRole("button", { name: "olive oil" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: "PATCH", body: { imageUrl: "olive-oil" } });
    expect(calls[0]?.url).toContain("/ingredients/ing_1");
  });

  it("sends null for Automatic", async () => {
    const user = userEvent.setup();
    const { calls } = renderPicker("garlic");
    await user.click(screen.getByRole("button", { name: /automatic/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: "PATCH", body: { imageUrl: null } });
  });
});
