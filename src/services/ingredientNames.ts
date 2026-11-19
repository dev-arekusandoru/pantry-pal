import { titleCaseName } from "../lib/titleCase.js";

/**
 * Ingredient name rules: a name identifies one ingredient. Quantities, sizes, preparation
 * and "x or y" belong on the recipe line, not in the ingredient name.
 */

export type NameLint = { ok: true } | { ok: false; reason: string; hint: string };

const ALTERNATIVES_HINT = "Use the main ingredient and add the others as alternatives.";
const NOTE_HINT = "Remove the extra text. Put preparation in prepNote.";
const SIZE_HINT = "Use the line unit (e.g. unit: large).";
const QUANTITY_HINT = "Put the amount in qty and unit. The name is only the ingredient.";

const UNIT_WORDS =
  "g|gr|kg|mg|ml|l|oz|lb|lbs|cups?|tbsp|tsp|tablespoons?|teaspoons?|pounds?|ounces?|grams?|kilograms?|liters?|litres?|milliliters?|cans?|jars?|cloves?|slices?|pieces?|sticks?|bunch(?:es)?|heads?|stalks?|sprigs?|pinch(?:es)?|dash(?:es)?";

const SEPARATORS: Array<{ pattern: RegExp; reason: string; hint: string }> = [
  { pattern: /\band\/or\b/i, reason: 'contains "and/or"', hint: ALTERNATIVES_HINT },
  { pattern: /\bor\b/i, reason: 'contains "or"', hint: ALTERNATIVES_HINT },
  { pattern: /\//, reason: 'contains "/"', hint: ALTERNATIVES_HINT },
  { pattern: /&/, reason: 'contains "&"', hint: ALTERNATIVES_HINT },
  { pattern: /\+/, reason: 'contains "+"', hint: ALTERNATIVES_HINT },
  { pattern: /[,;]/, reason: "contains a comma or semicolon", hint: NOTE_HINT },
  { pattern: /[()[\]{}]/, reason: "contains brackets", hint: NOTE_HINT },
];

const QUANTITIES: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^\s*(?:\d|[¼½¾⅓⅔⅛])/, reason: "starts with a number" },
  {
    pattern: new RegExp(`\\b\\d+(?:[.,/]\\d+)?\\s*-?\\s*(?:${UNIT_WORDS})\\b`, "i"),
    reason: "contains a quantity",
  },
];

const SIZE_WORDS = /\b(?:small|medium|large|jumbo|extra[- ]large)\b/i;

const PREP_WORDS: Array<{ pattern: RegExp; word: string }> = [
  {
    pattern:
      /\b(?:chopped|minced|sliced|peeled|softened|melted|beaten|cubed|grated|julienned|divided|optional)\b/i,
    word: "",
  },
  { pattern: /\bto taste\b/i, word: "to taste" },
  { pattern: /\broom temperature\b/i, word: "room temperature" },
  { pattern: /\bfor (?:serving|garnish)\b/i, word: "" },
];

/** Check a name before it becomes an ingredient (create and rename). */
export function lintIngredientName(name: string): NameLint {
  for (const { pattern, reason, hint } of SEPARATORS) {
    if (pattern.test(name)) return { ok: false, reason, hint };
  }
  for (const { pattern, reason } of QUANTITIES) {
    if (pattern.test(name)) return { ok: false, reason, hint: QUANTITY_HINT };
  }
  const size = SIZE_WORDS.exec(name);
  if (size) {
    return { ok: false, reason: `contains the size word "${size[0].toLowerCase()}"`, hint: SIZE_HINT };
  }
  for (const { pattern } of PREP_WORDS) {
    const match = pattern.exec(name);
    if (match) {
      return {
        ok: false,
        reason: `contains the preparation text "${match[0].toLowerCase()}"`,
        hint: "Use prepNote.",
      };
    }
  }
  return { ok: true };
}

/** Name parts of "milk or water" style text; one part when there is no separator. */
export function splitAlternatives(name: string): string[] {
  const parts = name
    .split(/\s+and\/or\s+|\s+or\s+|\s*\/\s*|\s*&\s*|\s*\+\s*/i)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return parts.length === 0 ? [name.trim()] : parts;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const STOP_WORDS = table(
  "a,an,and,as,for,in,of,or,the,to,with",
);
const NOISE_WORDS = table(
  "small,medium,large,jumbo,extra,chopped,minced,sliced,peeled,softened,melted,beaten,cubed,grated,julienned,divided,optional,taste,temperature,room,serving,garnish",
);

/** Static word tables: comma-separated words become a lookup record. */
function table(words: string): Record<string, true> {
  return Object.fromEntries(words.split(",").map((word) => [word.trim(), true]));
}

function has(words: Record<string, true>, word: string): boolean {
  return Object.hasOwn(words, word);
}

function singularWord(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ves") && /^(?:lea|loa|hal)ves$/.test(word)) return `${word.slice(0, -3)}f`;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ch|sh|x|ss|z|o)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** Lowercase singular words of a name, without stop, size, prep and number words. */
export function nameWords(name: string): string[] {
  const words = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word !== "" && !has(STOP_WORDS, word) && !has(NOISE_WORDS, word));
  return words.map(singularWord);
}

/** Text to search foods and ingredients with: the name without quantity, size and prep text. */
export function searchTextFor(name: string): string {
  return name
    .toLowerCase()
    .replace(new RegExp(`\\b\\d+(?:[.,/]\\d+)?\\s*-?\\s*(?:${UNIT_WORDS})?\\b`, "gi"), " ")
    .replace(/[()[\]{}]/g, " ")
    .split(/[^a-z-]+/)
    .filter((word) => word !== "" && !has(NOISE_WORDS, word))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Friendly names from USDA descriptions
// ---------------------------------------------------------------------------

/** USDA segments that never belong in a name: state, grade, packing and fat/lean figures. */
const NOISE_SEGMENT =
  /^(?:raw|fresh|unprepared|whole|enriched|unenriched|bleached|unbleached|fluid|regular|salted|unsalted|boneless|skinless|meat only|meat and skin|commercially prepared|ready-to-serve|ready to eat|drained|nfs|ns as to .*|includes? .*|with(?:out)? .*|solids and liquids|mature seeds|packed in .*|salad or cooking|year round average|flesh and skin|separable lean .*|broilers? or fryers?|all commercial varieties|cured|farmed|wild|atlantic|pacific|large or small curd|creamed|double-acting|\d.*)$/;

/** Heads that name a kind of product; the product is the next segment ("Cheese, cheddar"). */
const SUFFIX_HEADS = table(
  "cheese,oil,vinegar,sauce,juice,cream,syrup,bean,seed,nut",
);
/** Heads that only classify; the product is the next segment ("Spices, ginger, ground"). */
const CLASS_HEADS = table(
  "spice,fish,nut,seed,leavening agent,beverage,herb,fat,candy,cereal",
);
const MEATS = table(
  "beef,pork,chicken,turkey,lamb,veal,duck",
);
const CUTS = table(
  "ground,breast,thigh,drumstick,wing,loin,tenderloin,shoulder,rib,ribs,steak,roast,chuck,sirloin,brisket,flank,bacon,sausage,chop,leg",
);
/** Preservation or form words that identify a product ("Sun-dried tomatoes"). Keep the plural head. */
const FORM_WORDS = table(
  "dried,sun-dried,canned,frozen,smoked,toasted,shredded,cooked",
);
/** Variety words that identify a product ("White potato", "Brown sugar"). */
const VARIETY_WORDS = table(
  "white,red,green,yellow,brown,black,sweet,plain,ground,granulated,powdered,table,baby,all-purpose,heavy,light,dark",
);
const MASS_PLURALS = table(
  "oats,greens,grits,molasses,sprouts,peas,lentils,noodles,chips",
);

/** Whole-description overrides for staples where USDA wording is far from the usual name. */
const NAME_OVERRIDES: Array<[RegExp, string]> = [
  [/^wheat flour, white, all-purpose/i, "All-purpose flour"],
  [/^tomato products, canned, sauce/i, "Tomato sauce"],
  [/^soy sauce\b/i, "Soy sauce"],
  [/^cream, fluid, heavy whipping/i, "Heavy cream"],
  [/^peppers?, sweet, (red|green|yellow|orange)\b/i, "$1 bell pepper"],
  [/^peppers?, sweet\b/i, "Bell pepper"],
];

function singularHead(head: string): string {
  const words = head.split(" ");
  const last = words.pop() ?? "";
  if (has(MASS_PLURALS, last)) return head;
  return [...words, singularWord(last)].join(" ");
}

function deriveName(description: string): string {
  for (const [pattern, name] of NAME_OVERRIDES) {
    const match = pattern.exec(description);
    if (match) return titleCaseName(name.replace("$1", match[1] ?? ""));
  }

  const segments = description
    .replace(/\([^)]*\)/g, " ")
    .split(",")
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment !== "");
  if (segments.length === 0) return "";

  let head = (segments[0] ?? "").replace(/\s+(?:made from|made with|prepared with)\b.*$/, "");
  const rest = segments.slice(1).filter((segment) => !NOISE_SEGMENT.test(segment));
  const singular = singularHead(head);

  // Meat: the cut names the product ("Beef, ground" → "Ground beef", "Pork, cured, bacon" → "Bacon").
  if (has(MEATS, singular)) {
    const cut = rest.find((segment) => has(CUTS, segment.split(" ")[0] ?? ""));
    if (cut === undefined) return titleCaseName(singular);
    const cutWord = cut.split(" ")[0] ?? cut;
    if (cutWord === "bacon" || cutWord === "sausage") return titleCaseName(cutWord);
    return titleCaseName(cutWord === "ground" ? `ground ${singular}` : `${singular} ${cutWord}`);
  }

  // Classes ("Spices, ginger, ground"): the next segment is the product.
  if (has(CLASS_HEADS, singular) && rest.length > 0) {
    const [product, ...tail] = rest as [string, ...string[]];
    const forms = tail.filter((segment) => has(FORM_WORDS, segment) || has(VARIETY_WORDS, segment));
    const first = forms.filter((segment) => segment === "ground" || has(FORM_WORDS, segment));
    const later = forms.filter((segment) => !first.includes(segment));
    return titleCaseName([...first, ...later, product].join(" "));
  }

  // Product kinds ("Cheese, cheddar", "Oil, olive", "Soup, chicken broth").
  if (singular === "soup" && rest.length > 0) {
    const product = rest[0] as string;
    return titleCaseName(/\b(?:broth|stock|bouillon)\b/.test(product) ? product : `${product} soup`);
  }
  if (has(SUFFIX_HEADS, singular) && rest.length > 0) {
    const [product, ...tail] = rest as [string, ...string[]];
    const forms = tail.filter((segment) => has(FORM_WORDS, segment));
    const varieties = tail.filter((segment) => has(VARIETY_WORDS, segment));
    const words =
      singular === "bean"
        ? [...forms, ...varieties, product, head]
        : [...forms, ...varieties, product, singular];
    return titleCaseName(words.join(" "));
  }

  // Plain foods ("Onions, raw", "Tomatoes, sun-dried", "Potatoes, white, flesh and skin, raw").
  const forms = rest.filter((segment) => has(FORM_WORDS, segment));
  const varieties = rest.filter((segment) => has(VARIETY_WORDS, segment));
  if (forms.length > 0) return titleCaseName([...forms, ...varieties, head].join(" "));
  return titleCaseName([...varieties, singularHead(head)].join(" "));
}

/**
 * A friendly ingredient name for a USDA food description:
 * "Onions, raw" → "Onion", "Cheese, cheddar" → "Cheddar cheese", "Oil, olive, salad or cooking" → "Olive oil".
 * The result always passes {@link lintIngredientName}.
 */
export function suggestedNameForFood(description: string): string {
  const derived = deriveName(description);
  if (derived !== "" && lintIngredientName(derived).ok) return derived;
  const fallback = titleCaseName((description.split(",")[0] ?? "").replace(/\([^)]*\)/g, " ").replace(/[^A-Za-z -]/g, " "));
  return lintIngredientName(fallback).ok && fallback !== "" ? fallback : "Ingredient";
}
