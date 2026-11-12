import { describe, expect, it } from "vitest";
import { EMOJI_ASSETS } from "./foodIcons";
import { DEFAULT_ICON, hasIcon, ingredientEmoji } from "./ingredientEmoji";

describe("ingredientEmoji", () => {
  it.each([
    ["Ribeye steak", "ribeye-steak"],
    ["Garlic cloves", "garlic"],
    ["Olive oil", "olive-oil"],
    ["Coconut milk", "coconut-milk"],
    ["Chicken thighs", "chicken-drumstick"],
    ["Green onions", "spring-onion"],
    ["Jasmine rice", "white-rice"],
    ["Rice noodles", "rice-noodles"],
    ["Bananas", "banana"],
    ["Frozen peas", "frozen-peas"],
    ["Lime wedges", "lime-wedge"],
    ["Apples", "apple"],
    ["Pineapple", "pineapple"],
    ["Cherry tomatoes", "tomato"],
    ["Apple cider vinegar", "apple-cider-vinegar"],
    ["Rolled oats", "oats"],
    ["Chia seeds", "chia-seeds"],
    ["Vanilla extract", "vanilla-extract"],
    ["Water", "water"],
    ["Black pepper", "black-peppercorns"],
    ["Chipotle powder", "chili-powder"],
  ])("maps %s to %s", (name, icon) => {
    expect(ingredientEmoji(name)).toBe(icon);
  });

  it("falls back to the default icon for an unknown ingredient", () => {
    expect(ingredientEmoji("Mystery powder")).toBe(DEFAULT_ICON);
  });

  it("only returns icons that exist", () => {
    for (const name of ["beef", "chicken", "rice", "broth", "bread", "cinnamon", "parmesan", "unknown thing"]) {
      expect(EMOJI_ASSETS[ingredientEmoji(name)], name).toBeTypeOf("string");
    }
    expect(EMOJI_ASSETS[DEFAULT_ICON]).toBeTypeOf("string");
  });
});

describe("ingredientEmoji with an image reference", () => {
  it("uses a custom URL over a bundled icon and the matcher", () => {
    expect(ingredientEmoji("Garlic cloves", "https://cdn.example/garlic.png")).toBe("https://cdn.example/garlic.png");
  });

  it("uses a bundled icon name over the matcher", () => {
    expect(ingredientEmoji("Mystery powder", "garlic")).toBe("garlic");
  });

  it("falls back to the matcher for an unknown bare name", () => {
    expect(ingredientEmoji("Garlic cloves", "no-such-icon")).toBe("garlic");
  });
});

describe("hasIcon", () => {
  it("is false only when nothing matched and there is no custom reference", () => {
    expect(hasIcon("Garlic cloves", null)).toBe(true);
    expect(hasIcon("Mystery powder", null)).toBe(false);
    expect(hasIcon("Mystery powder", "garlic")).toBe(true);
    expect(hasIcon("Mystery powder", "https://cdn.example/garlic.png")).toBe(true);
  });
});
