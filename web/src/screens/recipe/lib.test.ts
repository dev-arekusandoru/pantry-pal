import { describe, expect, it } from "vitest";
import { EMOJI_ASSETS } from "@/ui/emoji";
import { formatClock, parseDurationSeconds, stepSeconds } from "./duration";
import { formatAmount, formatNumber, haveIngredient, localDate, recipeEmoji, type MealType } from "./lib";

describe("parseDurationSeconds", () => {
  it.each([
    ["Simmer for 10 minutes.", 600],
    ["Cook 5-6 hours on low", 6 * 3600],
    ["Rest 1 to 2 hours", 2 * 3600],
    ["Bake at 350 degrees F for 25 min", 25 * 60],
    ["Heat through, about 30 seconds", 30],
    ["Let it sit 1 1/2 hours", 5400],
    ["Chill for 1½ hrs", 5400],
    ["a 2-minute stir", 120],
    ["Cover and cook for 8 hours", 8 * 3600],
  ])("%s", (text, seconds) => {
    expect(parseDurationSeconds(text)).toBe(seconds);
  });

  it("ignores text without a duration", () => {
    expect(parseDurationSeconds("Add 2 cups of broth and 350 degrees of patience")).toBeNull();
    expect(parseDurationSeconds("Serve warm")).toBeNull();
  });
});

describe("stepSeconds", () => {
  it("prefers the structured duration", () => {
    expect(stepSeconds({ text: "Simmer for 10 minutes", durationMinutes: 4 })).toBe(240);
  });
  it("falls back to the text", () => {
    expect(stepSeconds({ text: "Simmer for 10 minutes", durationMinutes: null })).toBe(600);
  });
});

describe("formatClock", () => {
  it("formats minutes and hours", () => {
    expect(formatClock(90)).toBe("1:30");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(0.2)).toBe("0:01");
  });
});

describe("formatNumber / formatAmount", () => {
  it("uses kitchen fractions", () => {
    expect(formatNumber(1.5)).toBe("1½");
    expect(formatNumber(0.25)).toBe("¼");
    expect(formatNumber(0.333)).toBe("⅓");
    expect(formatNumber(2)).toBe("2");
    expect(formatNumber(1.999)).toBe("2");
    expect(formatNumber(1.42)).toBe("1.42");
    expect(formatNumber(0.0156)).toBe("0.02");
  });
  it("pluralizes spelled-out units only", () => {
    expect(formatAmount(1.5, null, "clove")).toBe("1½ cloves");
    expect(formatAmount(1, null, "cup")).toBe("1 cup");
    expect(formatAmount(2, null, "tbsp")).toBe("2 tbsp");
    expect(formatAmount(2, null, "count")).toBe("2");
    expect(formatAmount(1, 2, "head")).toBe("1–2 heads");
    expect(formatAmount(null, null, null)).toBe("");
  });
});

describe("haveIngredient", () => {
  const line = (over: Partial<Parameters<typeof haveIngredient>[1] & object>) => ({
    ingredientId: "i",
    unit: "cup",
    onHand: 2,
    onHandStatus: "on_hand" as const,
    ...over,
  });
  const need = { ingredientId: "i", qty: 1, unit: "cup" };
  it("compares quantities in the same unit", () => {
    expect(haveIngredient(need, line({}))).toBe("have");
    expect(haveIngredient({ ...need, qty: 3 }, line({}))).toBe("some");
    expect(haveIngredient(need, line({ onHand: 0, onHandStatus: "out" }))).toBe("none");
  });
  it("falls back to status across units or unknown amounts", () => {
    expect(haveIngredient(need, line({ unit: "g" }))).toBe("have");
    expect(haveIngredient(need, line({ onHand: null, onHandStatus: "low" }))).toBe("some");
    expect(haveIngredient(need, line({ onHand: null, onHandStatus: "unknown" }))).toBe("unknown");
  });
  it("treats a missing pantry line as none", () => {
    expect(haveIngredient(need, undefined)).toBe("none");
  });
});

describe("localDate", () => {
  it("uses the local calendar date", () => {
    expect(localDate(new Date(2026, 10, 2, 23, 59))).toBe("2026-11-02");
  });
});

describe("recipeEmoji", () => {
  it("returns bundled OpenMoji assets for every meal type and the fallback", () => {
    const meals: MealType[] = ["breakfast", "lunch", "dinner", "snack", "dessert"];
    for (const meal of meals) expect(EMOJI_ASSETS[recipeEmoji([meal])]).toBeTypeOf("string");
    expect(EMOJI_ASSETS[recipeEmoji([])]).toBeTypeOf("string");
  });

  it("prefers the dinner icon over other meal types", () => {
    expect(recipeEmoji(["breakfast", "dinner"])).toBe("1F35D");
  });
});
