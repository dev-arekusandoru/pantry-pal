import { describe, expect, it } from "vitest";
import { EMOJI_ASSETS } from "./emoji";
import { ingredientEmoji } from "./ingredientEmoji";

describe("ingredientEmoji", () => {
  it.each([
    ["Ribeye steak", "1F969"],
    ["Chicken thighs", "1F357"],
    ["Salmon fillet", "1F41F"],
    ["Large eggs", "1F95A"],
    ["Smoked bacon", "1F953"],
    ["Yellow onion", "1F9C5"],
    ["Garlic cloves", "1F9C4"],
    ["Carrots", "1F955"],
    ["Baby spinach", "1F96C"],
    ["Russet potatoes", "1F954"],
    ["Black pepper", "1F9C2"],
    ["Chili powder", "1F336"],
    ["Red bell pepper", "1FAD1"],
    ["Broccoli florets", "1F966"],
    ["Zucchini", "1F952"],
    ["Lemon juice", "1F34B"],
    ["Fresh basil", "1F33F"],
    ["Heavy cream", "1F95B"],
    ["Unsalted butter", "1F9C8"],
    ["Parmesan", "1F9C0"],
    ["Cherry tomatoes", "1F345"],
    ["Chickpeas", "1FAD8"],
    ["Olive oil", "1FAD7"],
    ["Kalamata olives", "1FAD2"],
    ["Jasmine rice", "1F35A"],
    ["Spaghetti", "1F35D"],
    ["All-purpose flour", "1F33E"],
    ["Honey", "1F36F"],
    ["Brown sugar", "1F36B"],
    ["Vegetable broth", "1F372"],
    ["Sesame seeds", "1F962"],
    ["Ground cumin", "1F9C2"],
    ["Sourdough bread", "1F35E"],
    ["Pancakes", "1F95E"],
    ["Strawberries", "1F353"],
    ["Greek yogurt", "1F963"],
    ["Sun-dried tomatoes in a jar", "1F345"],
  ])("maps %s to %s", (name, code) => {
    expect(ingredientEmoji(name)).toBe(code);
  });

  it("falls back to a bowl for an unknown ingredient", () => {
    expect(ingredientEmoji("Mystery powder")).toBe("1F963");
  });

  it("only returns codes that have a bundled OpenMoji asset", () => {
    const names = [
      "beef", "chicken", "fish", "egg", "bacon", "onion", "garlic", "carrot", "celery",
      "potato", "pepper", "bell pepper", "chili", "broccoli", "cucumber", "lime", "parsley",
      "milk", "butter", "cheese", "tomato", "lentils", "oil", "olive", "rice", "pasta",
      "flour", "honey", "cocoa", "stock", "soy sauce", "salt", "bread", "pancake", "apple",
      "yogurt", "jam jar", "unknown thing",
    ];
    for (const name of names) {
      const code = ingredientEmoji(name);
      expect(EMOJI_ASSETS[code], `${name} -> ${code}`).toBeTypeOf("string");
    }
  });
});
