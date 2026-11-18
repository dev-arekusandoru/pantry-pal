import { describe, expect, it } from "vitest";
import { autoMatchFood, getFood, gramsFor, NUTRITION_SOURCE, searchFoods, type Food } from "../src/services/foods.js";

function food(name: string): Food {
  const match = autoMatchFood(name);
  if (!match) throw new Error(`No auto-match for "${name}"`);
  return match;
}

describe("autoMatchFood", () => {
  it.each([
    ["Onion", "Onions, raw"],
    ["Yellow onion", "Onions, raw"],
    ["Red onion", "Onions, red, raw"],
    ["Garlic", "Garlic, raw"],
    ["Olive oil", "Oil, olive, salad or cooking"],
    ["Peanut oil", "Oil, peanut, salad or cooking"],
    ["Toasted sesame oil", "Oil, sesame, salad or cooking"],
    ["Butter", "Butter, salted"],
    ["All-purpose flour", "Wheat flour, white, all-purpose, enriched, bleached"],
    ["Granulated sugar", "Sugars, granulated"],
    ["Brown sugar", "Sugars, brown"],
    ["Eggs", "Egg, whole, raw, fresh"],
    ["Milk", "Milk, whole, 3.25% milkfat, with added vitamin D"],
    ["Chicken breast", "Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw"],
    ["Ground beef", "Beef, ground, 85% lean meat / 15% fat, raw"],
    ["Rice", "Rice, white, long-grain, regular, raw, enriched"],
    ["Salt", "Salt, table"],
    ["Black pepper", "Spices, pepper, black"],
    ["Carrots", "Carrots, raw"],
    ["White potato", "Potatoes, white, flesh and skin, raw"],
    ["Potatoes", "Potatoes, white, flesh and skin, raw"],
    ["Red bell pepper", "Peppers, sweet, red, raw"],
    ["Cheddar cheese", "Cheese, cheddar"],
    ["Shredded cheddar", "Cheese, cheddar"],
    ["Parmesan cheese", "Cheese, parmesan, grated"],
    ["Heavy cream", "Cream, fluid, heavy whipping"],
    ["Soy sauce", "Soy sauce made from soy and wheat (shoyu)"],
    ["Fresh basil", "Basil, fresh"],
    ["Dried oregano", "Spices, oregano, dried"],
    ["Ground ginger", "Spices, ginger, ground"],
    ["Rolled oats", "Cereals, oats, regular and quick, not fortified, dry"],
    ["Tomato sauce", "Tomato products, canned, sauce"],
    ["Canned diced tomatoes", "Tomatoes, canned, red, ripe, diced"],
    ["Sun-dried tomatoes (in oil)", "Tomatoes, sun-dried, packed in oil, drained"],
    ["Kidney beans", "Beans, kidney, red, mature seeds, canned, solids and liquids"],
    ["Dark red kidney beans", "Beans, kidney, red, mature seeds, canned, solids and liquids"],
    ["Penne pasta", "Pasta, dry, enriched"],
    ["Salmon fillets", "Fish, salmon, Atlantic, farmed, raw"],
  ])("matches %s", (name, description) => {
    expect(autoMatchFood(name)?.description).toBe(description);
  });

  it("ignores case, plurals and preparation words", () => {
    expect(autoMatchFood("CARROT")?.description).toBe("Carrots, raw");
    expect(autoMatchFood("finely chopped garlic")?.description).toBe("Garlic, raw");
    expect(autoMatchFood("Ground cumin")?.description).toBe("Spices, cumin seed");
  });

  it("returns null for nonsense and unknown foods", () => {
    expect(autoMatchFood("flurbo gizmo")).toBeNull();
    expect(autoMatchFood("asdf")).toBeNull();
    expect(autoMatchFood("")).toBeNull();
    expect(autoMatchFood("   ")).toBeNull();
    expect(autoMatchFood("Italian seasoning")).toBeNull();
    expect(autoMatchFood("Diced tomatoes with green chilies")).toBeNull();
  });

  it("returns null for names with alternatives", () => {
    expect(autoMatchFood("milk or water")).toBeNull();
    expect(autoMatchFood("butter / margarine")).toBeNull();
  });

  it("returns null for names too generic or ambiguous to pick one food", () => {
    expect(autoMatchFood("cheese")).toBeNull();
    expect(autoMatchFood("oil")).toBeNull();
    expect(autoMatchFood("pepper")).toBeNull();
    expect(autoMatchFood("tomato")).toBeNull();
  });

  it("never picks a brand, substitute or cooked variant for a plain name", () => {
    for (const name of ["Honey", "Cornstarch", "Vanilla extract", "Mayonnaise", "Bacon", "Water", "Bread"]) {
      const description = food(name).description;
      expect(description, name).not.toMatch(/imitation|substitute|meatless|[A-Z]{4,}/);
    }
    expect(food("Bacon").description).toMatch(/^Pork, cured, bacon/);
  });
});

describe("searchFoods", () => {
  it("ranks the best food first with scores between 0 and 1", () => {
    const results = searchFoods("onion", 5);
    expect(results).toHaveLength(5);
    expect(results[0]?.food.description).toBe("Onions, raw");
    for (const { score } of results) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
    expect([...results].sort((a, b) => b.score - a.score)).toEqual(results);
  });

  it("finds foods from a partial last word and respects the limit", () => {
    const results = searchFoods("chick", 3);
    expect(results).toHaveLength(3);
    expect(results.every((r) => /chick/i.test(r.food.description))).toBe(true);
  });

  it("offers foods with some of the words, below the auto-match score, when none has all", () => {
    const results = searchFoods("diced tomatoes with green chilies", 5);
    expect(results.length).toBeGreaterThan(0);
    for (const { score } of results) expect(score).toBeLessThan(0.5);
  });

  it("returns nothing for gibberish or an empty query", () => {
    expect(searchFoods("flurbo gizmo")).toEqual([]);
    expect(searchFoods("")).toEqual([]);
  });
});

describe("dataset", () => {
  it("looks foods up by FDC id and carries per-100 g nutrients", () => {
    const onion = food("Onion");
    expect(getFood(onion.fdcId)).toEqual(onion);
    expect(getFood(-1)).toBeNull();
    expect(onion.dataType).toBe("sr_legacy");
    expect(onion.per100g.calories).toBeCloseTo(40, 0);
    expect(onion.per100g.sodium).not.toBeNull();
  });

  it("credits USDA FoodData Central", () => {
    expect(NUTRITION_SOURCE).toContain("USDA FoodData Central");
  });
});

describe("gramsFor", () => {
  const flour = (): Food => food("All-purpose flour");

  it("converts mass units without portions", () => {
    expect(gramsFor(flour(), 100, "g")).toBe(100);
    expect(gramsFor(flour(), 2, "kg")).toBe(2000);
    expect(gramsFor(flour(), 1, "oz")).toBeCloseTo(28.35, 2);
    expect(gramsFor(flour(), 1, "lb")).toBeCloseTo(453.59, 2);
  });

  it("converts volume units through the food's density", () => {
    expect(gramsFor(flour(), 1, "cup")).toBeCloseTo(125, 0);
    expect(gramsFor(flour(), 0.5, "cups")).toBeCloseTo(62.5, 0);
    // 1 cup = 16 tbsp: derived from the cup portion.
    expect(gramsFor(flour(), 2, "tbsp")).toBeCloseTo(125 / 8, 1);
    expect(gramsFor(food("Milk"), 1, "cup")).toBeCloseTo(244, 0);
    expect(gramsFor(food("Milk"), 1, "fl oz")).toBeCloseTo(30.5, 1);
    expect(gramsFor(food("Olive oil"), 1, "tbsp")).toBeCloseTo(13.5, 1);
    expect(gramsFor(food("Olive oil"), 2, "tsp")).toBeCloseTo(9, 1);
  });

  it("converts count-ish units through the medium portion", () => {
    const onion = food("Onion");
    expect(gramsFor(onion, 1, null)).toBe(110);
    expect(gramsFor(onion, 1, "")).toBe(110);
    expect(gramsFor(onion, 2, "each")).toBe(220);
    expect(gramsFor(onion, 1, "whole")).toBe(110);
    expect(gramsFor(onion, 1, "medium")).toBe(110);
    expect(gramsFor(food("Eggs"), 1, "dozen")).toBeCloseTo(12 * 44, 0);
  });

  it("falls back to the first piece-like portion when there is no medium", () => {
    // Lemons list "fruit" and "wedge" portions, no "medium".
    expect(gramsFor(food("Lemon"), 2, null)).toBe(116);
  });

  it("converts named units through a portion with that name", () => {
    const garlic = food("Garlic");
    expect(gramsFor(garlic, 1, "clove")).toBe(3);
    expect(gramsFor(garlic, 3, "cloves")).toBe(9);
    expect(gramsFor(food("Onion"), 1, "large")).toBe(150);
    expect(gramsFor(food("Onion"), 1, "small")).toBe(70);
    expect(gramsFor(food("Bread"), 2, "slices")).toBeCloseTo(54.6, 1);
    expect(gramsFor(food("Butter"), 1, "stick")).toBe(113);
    expect(gramsFor(food("Kidney beans"), 1, "can")).toBe(436);
  });

  it("returns null when there is no basis", () => {
    expect(gramsFor(flour(), 1, "pinch")).toBeNull();
    expect(gramsFor(flour(), 1, "bunch")).toBeNull();
    expect(gramsFor(food("Garlic"), 1, "sprig")).toBeNull();
    // No portions at all: only mass units work.
    const bare: Food = { ...flour(), portions: [] };
    expect(gramsFor(bare, 1, "cup")).toBeNull();
    expect(gramsFor(bare, 1, null)).toBeNull();
    expect(gramsFor(bare, 1, "clove")).toBeNull();
    expect(gramsFor(bare, 50, "g")).toBe(50);
    expect(gramsFor(flour(), Number.NaN, "g")).toBeNull();
  });
});
