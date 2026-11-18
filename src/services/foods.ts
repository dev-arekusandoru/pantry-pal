import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { packageRoot } from "../db/client.js";
import { builtinFactor, normalizeUnit } from "./units.js";

/** Nutrient amounts. Per 100 g inside `Food`; absolute amounts elsewhere. */
export interface Nutrients {
  calories: number | null; // kcal
  protein: number | null; // g
  carbs: number | null; // g
  fat: number | null; // g
  fiber: number | null; // g
  sugar: number | null; // g
  sodium: number | null; // mg
}

/** Grams for ONE unit, e.g. `{ label: "cup", grams: 128 }`, `{ label: "medium", grams: 110 }`. */
export interface FoodPortion {
  label: string;
  grams: number;
}

export interface Food {
  fdcId: number;
  /** USDA description, e.g. "Onions, raw". */
  description: string;
  dataType: "sr_legacy" | "foundation";
  per100g: Nutrients;
  portions: FoodPortion[];
}

export interface FoodMatch {
  food: Food;
  /** 0..1, higher is better. */
  score: number;
}

/** Credit line for the bundled dataset (CC0). Keep in sync with `scripts/nutrition-data.ts`. */
export const NUTRITION_SOURCE = "USDA FoodData Central (SR Legacy 2018-04, Foundation 2025-12-18)";

/** Auto-match accepts a food only at or above this score: better no match than a wrong one. */
const AUTO_MATCH_MIN_SCORE = 0.6;
/** Auto-match refuses when a different food scores this close to the best: the name is ambiguous. */
const AUTO_MATCH_MIN_MARGIN = 0.03;
/** Search results below the strict (all words found) tier never reach this score. */
const PARTIAL_SCORE_FACTOR = 0.5;
const DEFAULT_SEARCH_LIMIT = 20;

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

/** Query words dropped entirely. */
const STOP_WORDS: Record<string, true> = {
  a: true,
  an: true,
  and: true,
  as: true,
  for: true,
  in: true,
  of: true,
  or: true,
  the: true,
  to: true,
  with: true,
};

/** Description words that cost nothing when they appear unrequested. */
const FREE_WORDS: Record<string, true> = {
  a: true,
  and: true,
  as: true,
  in: true,
  nfs: true,
  ns: true,
  of: true,
  only: true,
  or: true,
  raw: true,
  spice: true,
  the: true,
  to: true,
  with: true,
};

/**
 * Preparation / form words in a query. They never block a match, and a description
 * that has them scores slightly higher ("Spices, ginger, ground").
 */
const OPTIONAL_WORDS: Record<string, true> = {
  boneless: true,
  chopped: true,
  chunk: true,
  diced: true,
  extra: true,
  fillet: true,
  filet: true,
  finely: true,
  floret: true,
  fresh: true,
  freshly: true,
  grated: true,
  ground: true,
  large: true,
  medium: true,
  minced: true,
  organic: true,
  peeled: true,
  piece: true,
  pitted: true,
  shredded: true,
  skinless: true,
  sliced: true,
  small: true,
  sprig: true,
  stalk: true,
  virgin: true,
  wedge: true,
};

/** Cooking / preservation states: penalized when a description has them and the query does not. */
const STATE_WORDS: Record<string, true> = {
  baked: true,
  boiled: true,
  braised: true,
  broiled: true,
  canned: true,
  cooked: true,
  cured: true,
  dehydrated: true,
  dried: true,
  dry: true,
  fried: true,
  frozen: true,
  grilled: true,
  heated: true,
  microwaved: true,
  pickled: true,
  prepared: true,
  roasted: true,
  sauteed: true,
  smoked: true,
  steamed: true,
  stewed: true,
  toasted: true,
};

/** Words that mark a different product from the one asked for. */
const SUBSTITUTE_WORDS: Record<string, true> = {
  analog: true,
  artificial: true,
  imitation: true,
  meatless: true,
  substitute: true,
};

/** Single words too generic to pick one food for. */
const GENERIC_NAMES: Record<string, true> = {
  beans: true,
  cheese: true,
  fish: true,
  fruit: true,
  meat: true,
  oil: true,
  sauce: true,
  spice: true,
  vegetable: true,
};

const WORD_SYNONYMS: Record<string, string> = {
  chile: "chili",
  chiles: "chili",
  chilies: "chili",
  chilis: "chili",
  chilli: "chili",
  chillies: "chili",
  halves: "half",
  leaves: "leaf",
  loaves: "loaf",
  mayo: "mayonnaise",
  yoghurt: "yogurt",
};

/** Phrases where the usual name differs from the USDA wording. Applied to lowercase text. */
const PHRASE_SYNONYMS: Array<[RegExp, string]> = [
  [/\bsun[- ]?dried\b/g, "sun dried"],
  [/\b(?:dark|light) red kidney\b/g, "red kidney"],
  [/\b(?:red|crushed red) pepper flakes?\b|\bcrushed red pepper\b/g, "pepper red cayenne"],
  [/\bbell peppers?\b/g, "sweet pepper"],
  [/\bsweet paprika\b/g, "paprika"],
  [/\bdill\b(?! weed| seed)/g, "dill weed"],
  [/\b(?:yellow|white|brown) onions?\b/g, "onion"],
  [/\btoasted sesame oil\b/g, "sesame oil"],
  [/\brolled oats?\b|\bold[- ]fashioned oats?\b/g, "oat regular quick dry"],
  [/\b(?:penne|rigatoni|fusilli|rotini|farfalle)(?: pasta)?\b/g, "pasta dry"],
];

/** Plural → singular, tolerant enough to be applied identically to queries and descriptions. */
function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (/(?:ch|sh|x|ss|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "");
}

interface ParsedQuery {
  required: string[];
  optional: string[];
  /** The query offers alternatives ("milk or water"), so it names no single food. */
  alternatives: boolean;
}

function parseQuery(raw: string): ParsedQuery {
  let text = raw.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const alternatives = /\bor\b|\w\s*\/\s*\w/.test(text);
  for (const [pattern, replacement] of PHRASE_SYNONYMS) text = text.replace(pattern, replacement);
  const required: string[] = [];
  const optional: string[] = [];
  for (const raw of words(text)) {
    const word = WORD_SYNONYMS[raw] ?? raw;
    if (word in STOP_WORDS) continue;
    const s = stem(word);
    if (s in OPTIONAL_WORDS || word in OPTIONAL_WORDS) {
      if (!optional.includes(s)) optional.push(s);
    } else if (!required.includes(s)) required.push(s);
  }
  return { required, optional, alternatives };
}

// ---------------------------------------------------------------------------
// Dataset + index (lazy, cached)
// ---------------------------------------------------------------------------

interface IndexedFood {
  food: Food;
  /** Stemmed words of each comma segment, parentheticals removed. Segment 0 is the "head". */
  segments: string[][];
  /** Stemmed words inside parentheses: alternate names and notes. */
  notes: string[];
  all: Set<string>;
  /** stem → index of the first segment containing it (notes count as segment 1). */
  firstSegment: Map<string, number>;
  /** All-caps word or possessive: a brand rather than a plain food. */
  branded: boolean;
}

interface FoodIndex {
  byId: Map<number, IndexedFood>;
  foods: IndexedFood[];
  /** stem → foods containing it. */
  postings: Map<string, IndexedFood[]>;
}

let cachedIndex: FoodIndex | null = null;

function isBranded(description: string): boolean {
  return /\b[A-Z]{3,}\b/.test(description.replace(/\b(?:USDA|NFS|NS)\b/g, "")) || /\b[A-Z][A-Za-z]*'s\b/.test(description);
}

function loadIndex(): FoodIndex {
  if (cachedIndex) return cachedIndex;
  const file = path.join(packageRoot(), "nutrition", "usda-foods.json.gz");
  const foods = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as Food[];

  const index: FoodIndex = { byId: new Map(), foods: [], postings: new Map() };
  for (const food of foods) {
    const notes: string[] = [];
    const bare = food.description.replace(/\(([^)]*)\)/g, (_, inner: string) => {
      notes.push(...words(inner).map(stem));
      return " ";
    });
    const segments = bare.split(",").map((text) => words(text).map(stem));
    // A head such as "Spices" is a category, not part of the food's name: shift the rest forward.
    const shift = segments.length > 1 && (segments[0] ?? []).every((token) => token in FREE_WORDS) ? 1 : 0;
    const firstSegment = new Map<string, number>();
    segments.forEach((tokens, i) => {
      for (const token of tokens) if (!firstSegment.has(token)) firstSegment.set(token, Math.max(0, i - shift));
    });
    for (const token of notes) if (!firstSegment.has(token)) firstSegment.set(token, 1);
    const entry: IndexedFood = {
      food,
      segments,
      notes,
      all: new Set([...segments.flat(), ...notes]),
      firstSegment,
      branded: isBranded(food.description),
    };
    index.byId.set(food.fdcId, entry);
    index.foods.push(entry);
    for (const token of entry.all) {
      const list = index.postings.get(token);
      if (list) list.push(entry);
      else index.postings.set(token, [entry]);
    }
  }
  cachedIndex = index;
  return index;
}

export function getFood(fdcId: number): Food | null {
  return loadIndex().byId.get(fdcId)?.food ?? null;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Staples where USDA lists many equal entries (egg white / yolk / whole, milk fat levels,
 * rice varieties...). The listed entry wins ties; it must still match the query words.
 * Keys are the parsed query words (with, else without, the optional ones), sorted and joined by a space.
 */
const PREFERRED: Record<string, string> = {
  "all flour purpose": "Wheat flour, white, all-purpose, enriched, bleached",
  "baking powder": "Leavening agents, baking powder, double-acting, sodium aluminum sulfate",
  "beef broth": "Soup, beef broth or bouillon canned, ready-to-serve",
  "beef ground": "Beef, ground, 85% lean meat / 15% fat, raw",
  bacon: "Pork, cured, bacon, unprepared",
  bread: "Bread, white, commercially prepared",
  butter: "Butter, salted",
  "dry pasta": "Pasta, dry, enriched",
  pasta: "Pasta, dry, enriched",
  "breast chicken": "Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw",
  "cheese parmesan": "Cheese, parmesan, grated",
  "cheese mozzarella": "Cheese, mozzarella, whole milk",
  "cream heavy": "Cream, fluid, heavy whipping",
  egg: "Egg, whole, raw, fresh",
  flour: "Wheat flour, white, all-purpose, enriched, bleached",
  "bean kidney red": "Beans, kidney, red, mature seeds, canned, solids and liquids",
  "bean kidney": "Beans, kidney, red, mature seeds, canned, solids and liquids",
  mayonnaise: "Salad dressing, mayonnaise, regular",
  milk: "Milk, whole, 3.25% milkfat, with added vitamin D",
  onion: "Onions, raw",
  potato: "Potatoes, white, flesh and skin, raw",
  rice: "Rice, white, long-grain, regular, raw, enriched",
  salmon: "Fish, salmon, Atlantic, farmed, raw",
  "sauce soy": "Soy sauce made from soy and wheat (shoyu)",
  "sauce tomato": "Tomato products, canned, sauce",
  sugar: "Sugars, granulated",
  tofu: "Tofu, raw, firm, prepared with calcium sulfate",
  yeast: "Leavening agents, yeast, baker's, active dry",
  zucchini: "Squash, summer, zucchini, includes skin, raw",
};

interface Scored {
  entry: IndexedFood;
  score: number;
}

function wordMatches(entry: IndexedFood, word: string, prefix: boolean): boolean {
  if (entry.all.has(word)) return true;
  if (!prefix) return false;
  for (const candidate of entry.all) if (candidate.startsWith(word)) return true;
  return false;
}

function scoreEntry(entry: IndexedFood, query: ParsedQuery, preferred: string | undefined, prefixLast: boolean): number {
  // Unclamped (can exceed 1) so the preferred bonus still breaks ties between perfect matches.
  const asked = new Set([...query.required, ...query.optional]);
  const lastRequired = query.required[query.required.length - 1];

  // A prefix-matched final word ("onio") counts as asked, not as an extra word.
  const isAsked = (token: string): boolean =>
    asked.has(token) || (prefixLast && lastRequired !== undefined && token.startsWith(lastRequired));

  let extraPenalty = 0;
  let stateExtra = 0;
  let substitute = 0;
  entry.segments.forEach((tokens, i) => {
    const extras = tokens.filter((token) => !isAsked(token) && !(token in FREE_WORDS)).length;
    // Extra words beside a matched word ("tuna salad", "chickpea flour") name another food.
    const compound = tokens.some(isAsked);
    extraPenalty += extras * (i === 0 ? 0.15 : compound ? 0.1 : 0.04);
  });
  extraPenalty += 0.005 * entry.notes.filter((token) => !isAsked(token)).length;
  for (const token of entry.all) {
    if (isAsked(token)) continue;
    if (token in STATE_WORDS) stateExtra++;
    if (token in SUBSTITUTE_WORDS) substitute++;
  }
  // Asked-for words found late in the description ("Oil, corn, peanut, and olive") hint at a mixture.
  let lateWords = 0;
  for (const word of query.required) lateWords += Math.max(0, (entry.firstSegment.get(word) ?? 0) - 1);
  const optionalHits = query.optional.filter((word) => entry.all.has(word)).length;

  let score = 1;
  score -= Math.min(0.45, extraPenalty);
  score -= Math.min(0.14, 0.07 * lateWords);
  score -= Math.min(0.24, 0.08 * stateExtra);
  if (substitute > 0) score -= 0.2;
  if (entry.branded) score -= 0.3;
  score += Math.min(0.1, 0.05 * optionalHits);
  if (entry.food.dataType === "sr_legacy") score += 0.03;
  if (entry.food.portions.length > 0) score += 0.03;
  if (preferred !== undefined && entry.food.description === preferred) score += 0.4;
  return Math.max(0, score);
}

/** Foods containing every required word; the last word may be a prefix when `prefixLast`. */
function strictCandidates(index: FoodIndex, required: string[], prefixLast: boolean): IndexedFood[] {
  let pool: IndexedFood[] | null = null;
  const lastIdx = required.length - 1;
  for (let i = 0; i < required.length; i++) {
    const word = required[i] as string;
    let matches: IndexedFood[];
    if (prefixLast && i === lastIdx) {
      const seen = new Set<IndexedFood>();
      for (const [token, list] of index.postings) {
        if (token.startsWith(word)) for (const entry of list) seen.add(entry);
      }
      matches = [...seen];
    } else {
      matches = index.postings.get(word) ?? [];
    }
    if (pool === null) pool = matches;
    else {
      const have = new Set(matches);
      pool = pool.filter((entry) => have.has(entry));
    }
    if (pool.length === 0) return [];
  }
  return pool ?? [];
}

function rank(scored: Scored[]): Scored[] {
  return scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.entry.food.dataType === b.entry.food.dataType ? 0 : a.entry.food.dataType === "sr_legacy" ? -1 : 1) ||
      a.entry.food.description.length - b.entry.food.description.length ||
      a.entry.food.fdcId - b.entry.food.fdcId,
  );
}

function runSearch(query: ParsedQuery, prefixLast: boolean, limit: number): Scored[] {
  if (query.required.length === 0) return [];
  const index = loadIndex();
  const key = (list: string[]): string => [...list].sort().join(" ");
  const preferred = PREFERRED[key([...query.required, ...query.optional])] ?? PREFERRED[key(query.required)];

  const strict = strictCandidates(index, query.required, prefixLast);
  if (strict.length > 0) {
    const scored = strict.map((entry) => ({ entry, score: scoreEntry(entry, query, preferred, prefixLast) }));
    return rank(scored).slice(0, limit);
  }
  if (!prefixLast) return [];

  // Search only: nothing has every word, so offer foods with some of them, ranked by coverage.
  const counts = new Map<IndexedFood, number>();
  for (const word of query.required) {
    for (const entry of index.foods) {
      if (wordMatches(entry, word, false)) counts.set(entry, (counts.get(entry) ?? 0) + 1);
    }
  }
  const scored: Scored[] = [];
  for (const [entry, hit] of counts) {
    const coverage = hit / query.required.length;
    scored.push({ entry, score: PARTIAL_SCORE_FACTOR * coverage * scoreEntry(entry, query, undefined, false) });
  }
  return rank(scored).slice(0, limit);
}

/**
 * Ranked foods for a free-text query, best first. The last word may be a partial word.
 * Every word should appear in the description; if no food has them all, foods with some
 * of the words follow, scored below the auto-match threshold.
 */
export function searchFoods(query: string, limit: number = DEFAULT_SEARCH_LIMIT): FoodMatch[] {
  const parsed = parseQuery(query);
  return runSearch(parsed, true, Math.max(0, limit)).map(({ entry, score }) => ({
    food: entry.food,
    score: Math.round(Math.min(1, score) * 1000) / 1000,
  }));
}

/** Best match for an ingredient name, or `null` when no food is a confident match. */
export function autoMatchFood(name: string): Food | null {
  const parsed = parseQuery(name);
  if (parsed.alternatives || parsed.required.length === 0) return null;
  if (parsed.required.length === 1 && parsed.optional.length === 0 && (parsed.required[0] as string) in GENERIC_NAMES) {
    return null;
  }
  const [best, ...others] = runSearch(parsed, false, 10);
  if (!best || best.score < AUTO_MATCH_MIN_SCORE) return null;
  const description = best.entry.food.description.toLowerCase();
  const rival = others.find((other) => other.entry.food.description.toLowerCase() !== description);
  if (rival && best.score - rival.score < AUTO_MATCH_MIN_MARGIN) return null;
  return best.entry.food;
}

// ---------------------------------------------------------------------------
// Portions → grams
// ---------------------------------------------------------------------------

/** Preference when deriving a density: larger measures are rounded less. */
const DENSITY_UNIT_ORDER = ["cup", "tbsp", "tsp", "fl_oz", "ml", "l", "pint", "quart", "gallon"];
/** Label heads that are not one natural piece of the food. */
const NOT_A_PIECE: Record<string, true> = {
  bag: true,
  bottle: true,
  box: true,
  can: true,
  carton: true,
  container: true,
  jar: true,
  lb: true,
  oz: true,
  pack: true,
  package: true,
  packet: true,
  recipe: true,
  serving: true,
  slice: true,
  stick: true,
};

interface ParsedLabel {
  portion: FoodPortion;
  /** "cup", "medium", "slice"; singular. */
  head: string;
  /** Text after the head, e.g. "chopped" in "cup, chopped". */
  modifier: string;
  /** Canonical volume unit when the head is one ("cup", "tbsp", "fl_oz"). */
  volume: string | null;
}

function parseLabel(portion: FoodPortion): ParsedLabel {
  const label = portion.label.toLowerCase().trim();
  const fl = /^fl\.? ?oz\b/.exec(label);
  const first = fl ? "fl oz" : (/^[a-z0-9]+/.exec(label)?.[0] ?? label);
  const modifier = label.slice(fl ? fl[0].length : first.length).replace(/^[\s,]+/, "");
  const unit = normalizeUnit(first);
  const volume = unit !== null && builtinFactor(unit, "volume") !== null ? unit : null;
  return { portion, head: volume ?? stem(first), modifier, volume };
}

/** Lowest index of the preferred portion: no modifier, then "medium", then listing order. */
function pickPortion(candidates: ParsedLabel[]): ParsedLabel | null {
  return (
    candidates.find((p) => p.modifier === "") ??
    candidates.find((p) => p.modifier.startsWith("medium")) ??
    candidates[0] ??
    null
  );
}

function volumeGrams(portions: ParsedLabel[], qty: number, unit: string): number | null {
  const volumePortions = portions.filter((p) => p.volume !== null);
  if (volumePortions.length === 0) return null;

  // A portion in the very unit asked for is exact.
  const direct = pickPortion(volumePortions.filter((p) => p.volume === unit));
  if (direct) return qty * direct.portion.grams;

  // Otherwise derive grams per ml from the best other volume portion.
  for (const base of DENSITY_UNIT_ORDER) {
    const chosen = pickPortion(volumePortions.filter((p) => p.volume === base));
    if (!chosen) continue;
    const gramsPerMl = chosen.portion.grams / (builtinFactor(base, "volume") as number);
    return qty * (builtinFactor(unit, "volume") as number) * gramsPerMl;
  }
  return null;
}

function countGrams(portions: ParsedLabel[], qty: number): number | null {
  const medium = portions.find((p) => p.head === "medium");
  if (medium) return qty * medium.portion.grams;
  const piece = portions.find(
    (p) => p.volume === null && builtinFactor(p.head, "mass") === null && !(p.head in NOT_A_PIECE),
  );
  return piece ? qty * piece.portion.grams : null;
}

/**
 * Grams in `qty` of `unit` for this food, using the food's own portions:
 * mass units directly; volume units through the density of its volume portions;
 * count-ish units (none, "each", "whole", "piece") through its "medium" or first piece-like
 * portion; any other unit (clove, slice, can, stick, large...) through a portion of that name.
 * `null` when the food has no basis for the conversion.
 */
export function gramsFor(food: Food, qty: number, unit: string | null | undefined): number | null {
  if (!Number.isFinite(qty)) return null;
  const normalized = normalizeUnit(unit);

  const gramsPerUnit = normalized === null ? null : builtinFactor(normalized, "mass");
  if (gramsPerUnit !== null) return qty * gramsPerUnit;

  const portions = food.portions.map(parseLabel);

  if (normalized !== null && builtinFactor(normalized, "volume") !== null) {
    return volumeGrams(portions, qty, normalized);
  }

  // `normalizeUnit` maps null/undefined to null and ""/"each"/"whole" to "count".
  if (unit === null || unit === undefined) return countGrams(portions, qty);
  const perCount = normalized === null ? null : builtinFactor(normalized, "count");
  if (perCount !== null) {
    const grams = countGrams(portions, qty);
    return grams === null ? null : grams * perCount;
  }

  // Named portion: "clove", "slice", "can", "large", "stick"...
  const key = stem((normalized ?? unit).toLowerCase().trim());
  if (key === "") return null;
  const named = pickPortion(portions.filter((p) => p.volume === null && p.head === key));
  return named ? qty * named.portion.grams : null;
}
