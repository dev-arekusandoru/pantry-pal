import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnitPicker } from "./UnitPicker";

afterEach(() => vi.unstubAllGlobals());

const DETAIL = {
  id: "ing_1",
  name: "Baby Spinach",
  stockUnit: "oz",
  measures: [{ unit: "cup", grams: 30, source: "usda_estimated", estimated: true, label: "cup", note: null, usdaGrams: null }],
  units: ["oz", "cup", "g"],
};

function Harness() {
  const [unit, setUnit] = useState("");
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UnitPicker label="Unit" ingredientId="ing_1" value={unit} onChange={setUnit} />
    </QueryClientProvider>
  );
}

function stub() {
  const puts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "PUT") {
        puts.push(url.pathname);
        const body = (await req.json()) as { grams: number };
        return Response.json({ unit: "handful", grams: body.grams, source: "user", estimated: false, label: null, note: null, usdaGrams: null });
      }
      return Response.json(DETAIL);
    }),
  );
  return puts;
}

describe("UnitPicker", () => {
  it("lists the stock unit first with measure grams as secondary text", async () => {
    stub();
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("combobox", { name: "Unit" }));
    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveTextContent("oz");
    expect(options[0]).toHaveTextContent("Stock unit");
    expect(options[1]).toHaveTextContent("30 g (estimated)");
  });

  it("offers to add a measure for an unknown unit and selects it after saving", async () => {
    const puts = stub();
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByRole("combobox", { name: "Unit" });
    await screen.findByRole("combobox");
    await user.click(box);
    await screen.findAllByRole("option");
    await user.type(box, "handful");
    await user.click(await screen.findByRole("option", { name: "Add a measure: 1 handful = ? g" }));
    await user.type(screen.getByLabelText("Weight in grams"), "40");
    await user.click(screen.getByRole("button", { name: "Save measure" }));
    await waitFor(() => expect(puts).toEqual(["/api/v1/ingredients/ing_1/measures/handful"]));
    await waitFor(() => expect(box).toHaveValue("handful"));
    expect(screen.queryByLabelText("Weight in grams")).not.toBeInTheDocument();
  });
});
