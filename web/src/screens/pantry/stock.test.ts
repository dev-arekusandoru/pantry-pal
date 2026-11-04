import { describe, expect, it } from "vitest";
import { groupByLocation, nextStatus, stepFor, type PantryItem } from "./stock";

const item = (name: string, location: PantryItem["location"]): PantryItem =>
  ({ id: name, ingredient: { id: name, name, category: "other" }, location }) as PantryItem;

describe("stepFor", () => {
  it("uses fine steps for bulk units and 1 for everything countable", () => {
    expect(stepFor("lb")).toBe(0.5);
    expect(stepFor("g")).toBe(50);
    expect(stepFor("can")).toBe(1);
    expect(stepFor("count")).toBe(1);
    expect(stepFor(null)).toBe(1);
  });
});

describe("nextStatus", () => {
  it("cycles on hand, low, out and back", () => {
    expect(nextStatus("on_hand")).toBe("low");
    expect(nextStatus("low")).toBe("out");
    expect(nextStatus("out")).toBe("on_hand");
    expect(nextStatus("unknown")).toBe("on_hand");
  });
});

describe("groupByLocation", () => {
  const items = [item("Rice", "pantry"), item("Milk", "fridge"), item("Beans", "pantry"), item("Peas", "freezer")];
  it("groups in shelf order, sorted by name", () => {
    const groups = groupByLocation(items, "", "all");
    expect(groups.map((g) => g.location)).toEqual(["fridge", "pantry", "freezer"]);
    expect(groups[1]?.items.map((i) => i.ingredient.name)).toEqual(["Beans", "Rice"]);
  });
  it("filters by text and location", () => {
    expect(groupByLocation(items, "RI", "all").flatMap((g) => g.items.map((i) => i.id))).toEqual(["Rice"]);
    expect(groupByLocation(items, "", "fridge").map((g) => g.location)).toEqual(["fridge"]);
  });
});
