import { describe, expect, it } from "vitest";
import { buildRows, countFilters, filterRows, groupByAisle, parseFilter } from "./library";
import type { IngredientView } from "./queries";

function ingredient(
  id: string,
  name: string,
  category: IngredientView["category"],
  fdcId: number | null,
  aliases: string[] = [],
  measures: string[] = ["cup"],
): IngredientView {
  return {
    id,
    name,
    category,
    aliases: aliases.map((alias, index) => ({ id: `${id}-${index}`, alias, createdAt: "" })),
    measures: measures.map((unit) => ({ unit, grams: 30, source: "usda", estimated: false, usdaGrams: 30, label: null, note: null })),
    nutrition: fdcId === null ? null : { source: "manual", fdcId, description: `Food ${fdcId}`, per100g: null, portions: [] },
  } as unknown as IngredientView;
}

const ITEMS = [
  ingredient("a", "Birria Paste", "condiment", null, [], []),
  ingredient("b", "Egg", "protein", 1, ["eggs"]),
  ingredient("c", "Milk", "dairy", 2),
  ingredient("d", "Butter", "dairy", 3, [], []),
];

const rows = buildRows(ITEMS, new Set(["a"]), new Set(["b", "c"]));

describe("ingredient library", () => {
  it("derives linked, attention, measures and unused per ingredient", () => {
    expect(rows.map((row) => [row.ingredient.id, row.linked, row.attention, row.noMeasures, row.unused])).toEqual([
      ["a", false, true, true, true],
      ["b", true, false, false, false],
      ["c", true, false, false, false],
      ["d", true, false, true, true],
    ]);
  });

  it("counts every chip", () => {
    expect(countFilters(rows)).toEqual({ all: 4, attention: 1, custom: 1, measures: 2, unused: 2 });
  });

  it("filters by chip and by name or alias", () => {
    expect(filterRows(rows, "attention", "").map((row) => row.ingredient.name)).toEqual(["Birria Paste"]);
    expect(filterRows(rows, "custom", "").map((row) => row.ingredient.name)).toEqual(["Birria Paste"]);
    expect(filterRows(rows, "measures", "").map((row) => row.ingredient.name)).toEqual(["Birria Paste", "Butter"]);
    expect(filterRows(rows, "unused", "").map((row) => row.ingredient.name)).toEqual(["Birria Paste", "Butter"]);
    expect(filterRows(rows, "all", "EGGS").map((row) => row.ingredient.name)).toEqual(["Egg"]);
    expect(filterRows(rows, "unused", "milk")).toEqual([]);
  });

  it("groups by aisle in shopping order and drops empty aisles", () => {
    expect(groupByAisle(rows).map((group) => [group.category, group.rows.length])).toEqual([
      ["protein", 1],
      ["dairy", 2],
      ["condiment", 1],
    ]);
  });

  it("reads the filter from the URL", () => {
    expect(parseFilter("attention")).toBe("attention");
    expect(parseFilter("nope")).toBe("all");
    expect(parseFilter(undefined)).toBe("all");
  });
});
