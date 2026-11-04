/** Emoji for an ingredient, by keyword. First match wins, so specific patterns come first. */
const TABLE: ReadonlyArray<readonly [RegExp, string]> = [
  [/beef/, "🥩"],
  [/chicken|turkey/, "🍗"],
  [/salmon|tuna|fish|shrimp/, "🐟"],
  [/egg/, "🥚"],
  [/bacon|pork|sausage|ham\b/, "🥓"],
  [/onion|shallot|leek/, "🧅"],
  [/garlic/, "🧄"],
  [/carrot/, "🥕"],
  [/celery|lettuce|spinach|kale|cabbage/, "🥬"],
  [/turnip|parsnip|potato/, "🥔"],
  [/black pepper|peppercorn|pepper flake|red pepper flakes/, "🧂"],
  [/bell pepper|pepper/, "🫑"],
  [/broccoli/, "🥦"],
  [/zucchini|cucumber/, "🥒"],
  [/lemon|lime/, "🍋"],
  [/basil|dill|rosemary|parsley|cilantro|thyme|sage|mint/, "🌿"],
  [/cream|milk/, "🥛"],
  [/butter/, "🧈"],
  [/cheese|parmesan|cheddar|mozzarella/, "🧀"],
  [/tomato/, "🍅"],
  [/bean|lentil|chickpea/, "🫘"],
  [/olive/, "🫒"],
  [/rice/, "🍚"],
  [/pasta|penne|noodle|spaghetti/, "🍝"],
  [/flour|cornstarch|oat/, "🌾"],
  [/honey/, "🍯"],
  [/sugar|cocoa|chocolate/, "🍫"],
  [/broth|stock|soup/, "🍲"],
  [/oil/, "🫒"],
  [/soy|sesame/, "🥢"],
  [/salt|cumin|paprika|chili|oregano|ginger|coriander|flake|spice|cinnamon/, "🧂"],
  [/bread|toast|bun\b|tortilla/, "🍞"],
  [/pancake/, "🥞"],
  [/banana|berry|berries|apple|fruit/, "🍓"],
  [/yogurt/, "🥣"],
  [/jar|sun-dried/, "🫙"],
];

/** Decorative emoji for an ingredient name; a bowl when nothing matches. */
export function ingredientEmoji(name: string): string {
  const n = name.toLowerCase();
  for (const [re, emoji] of TABLE) if (re.test(n)) return emoji;
  return "🥣";
}
