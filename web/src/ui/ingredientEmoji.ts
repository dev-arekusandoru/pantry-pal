import type { EmojiCode } from "./emoji";

/**
 * OpenMoji hexcode for an ingredient, by keyword. First match wins, so specific
 * patterns come first. Values must be present in `emoji.ts`.
 */
const TABLE: ReadonlyArray<readonly [RegExp, EmojiCode]> = [
  [/beef|steak/, "1F969"],
  [/chicken|turkey/, "1F357"],
  [/salmon|tuna|fish|shrimp|prawn/, "1F41F"],
  [/egg/, "1F95A"],
  [/bacon|pork|sausage|ham\b/, "1F953"],
  [/onion|shallot|leek/, "1F9C5"],
  [/garlic/, "1F9C4"],
  [/carrot/, "1F955"],
  [/celery|lettuce|spinach|kale|cabbage/, "1F96C"],
  [/turnip|parsnip|potato/, "1F954"],
  [/black pepper|peppercorn|pepper flake|red pepper flakes/, "1F9C2"],
  [/chili|cayenne|jalape|sriracha/, "1F336"],
  [/bell pepper|pepper/, "1FAD1"],
  [/broccoli/, "1F966"],
  [/zucchini|cucumber/, "1F952"],
  [/lemon|lime/, "1F34B"],
  [/basil|dill|rosemary|parsley|cilantro|thyme|sage|mint/, "1F33F"],
  [/cream|milk/, "1F95B"],
  [/butter/, "1F9C8"],
  [/cheese|parmesan|cheddar|mozzarella/, "1F9C0"],
  [/tomato/, "1F345"],
  [/bean|lentil|chickpea/, "1FAD8"],
  [/oil|vinegar/, "1FAD7"],
  [/olive/, "1FAD2"],
  [/rice/, "1F35A"],
  [/pasta|penne|noodle|spaghetti/, "1F35D"],
  [/flour|cornstarch|oat/, "1F33E"],
  [/honey/, "1F36F"],
  [/sugar|cocoa|chocolate/, "1F36B"],
  [/broth|stock|soup/, "1F372"],
  [/soy|sesame/, "1F962"],
  [/salt|cumin|paprika|oregano|ginger|coriander|flake|spice|cinnamon|nutmeg|clove/, "1F9C2"],
  [/bread|toast|bun\b|tortilla/, "1F35E"],
  [/pancake/, "1F95E"],
  [/banana|berry|berries|apple|fruit/, "1F353"],
  [/yogurt/, "1F963"],
  [/jar|sun-dried/, "1FAD9"],
];

/** Decorative OpenMoji code for an ingredient name; a bowl when nothing matches. */
export function ingredientEmoji(name: string): EmojiCode {
  const n = name.toLowerCase();
  for (const [re, code] of TABLE) if (re.test(n)) return code;
  return "1F963";
}
