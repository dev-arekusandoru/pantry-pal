/**
 * Regenerate `nutrition/usda-foods.json.gz` from the USDA FoodData Central CSV downloads.
 * The server loads that snapshot at runtime (src/services/foods.ts); it never downloads anything.
 * Run `pnpm nutrition:data` to rebuild. Downloads are cached in the OS temp directory.
 *
 * Sources (public domain, CC0): SR Legacy 2018-04 and Foundation Foods 2025-12-18.
 * Keep the dataset names in `NUTRITION_SOURCE` (src/services/foods.ts) in sync when URLs change.
 * (The 2026-10-29 Foundation zip is broken: it has no food.csv.)
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, inflateRawSync } from "node:zlib";

const SR_LEGACY_URL =
  "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip";
const FOUNDATION_URL =
  "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2025-12-18.zip";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(root, "nutrition", "usda-foods.json.gz");
const cacheDir = path.join(tmpdir(), "pantrypal-fdc");

type DataType = "sr_legacy" | "foundation";

interface Source {
  url: string;
  /** `data_type` value in food.csv that this source contributes. */
  csvType: string;
  dataType: DataType;
}

const SOURCES: Source[] = [
  { url: SR_LEGACY_URL, csvType: "sr_legacy_food", dataType: "sr_legacy" },
  { url: FOUNDATION_URL, csvType: "foundation_food", dataType: "foundation" },
];

/**
 * food_category ids dropped: baby foods, fast foods, restaurant foods, branded and
 * quality-control entries. They are brand names that only cause false matches.
 */
const EXCLUDED_CATEGORIES: Record<string, true> = { "3": true, "21": true, "25": true, "26": true, "27": true };

/** Per-100 g nutrients; the first id with a value wins. Sodium is mg, calories kcal. */
const NUTRIENT_IDS = {
  calories: [1008, 2047, 2048],
  protein: [1003],
  carbs: [1005, 1050],
  fat: [1004],
  fiber: [1079],
  sugar: [2000, 1063],
  sodium: [1093],
} as const;
type NutrientKey = keyof typeof NUTRIENT_IDS;
const NUTRIENT_KEYS = Object.keys(NUTRIENT_IDS) as NutrientKey[];
const WANTED_NUTRIENT_IDS = new Set<string>(NUTRIENT_KEYS.flatMap((k) => NUTRIENT_IDS[k].map(String)));

const UNIT_LABELS: Record<string, string> = {
  cup: "cup",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  teaspoon: "tsp",
  liter: "l",
  milliliter: "ml",
  gallon: "gallon",
  pint: "pint",
  quart: "quart",
  "fl oz": "fl oz",
  oz: "oz",
  lb: "lb",
};
/** measure_unit names that describe the source weight basis, not a usable household unit. */
const SKIPPED_UNITS: Record<string, true> = {
  "orig ckd g": true,
  "orig rw g": true,
  "paired cooked w": true,
  "paired raw w": true,
  "dripping w": true,
  "cubic inch": true,
  "cubic centimeter": true,
};

interface Portion {
  label: string;
  grams: number;
  /** Present (true) only on portions borrowed from another food. */
  estimated?: true;
}
interface Nutrients {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sugar: number | null;
  sodium: number | null;
}
interface OutFood {
  fdcId: number;
  description: string;
  dataType: DataType;
  per100g: Nutrients;
  portions: Portion[];
  /** fdcId of the SR Legacy food whose portions this food borrowed. */
  portionsFrom?: number;
}

// ---------------------------------------------------------------------------
// Download + minimal zip reader (central directory, deflate/stored only)
// ---------------------------------------------------------------------------

async function fetchCached(url: string): Promise<Buffer> {
  mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, path.basename(url));
  if (existsSync(file) && statSync(file).size > 0) {
    console.log(`Using cached ${file}`);
    return readFileSync(file);
  }
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`);
  const data = Buffer.from(await res.arrayBuffer());
  writeFileSync(`${file}.part`, data);
  renameSync(`${file}.part`, file);
  return data;
}

function readZipEntries(zip: Buffer): Map<string, () => Buffer> {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file (end of central directory not found)");
  const count = zip.readUInt16LE(eocd + 10);
  let pos = zip.readUInt32LE(eocd + 16);
  const entries = new Map<string, () => Buffer>();
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) throw new Error("Corrupt zip central directory");
    const method = zip.readUInt16LE(pos + 10);
    const compressedSize = zip.readUInt32LE(pos + 20);
    const nameLen = zip.readUInt16LE(pos + 28);
    const extraLen = zip.readUInt16LE(pos + 30);
    const commentLen = zip.readUInt16LE(pos + 32);
    const localOffset = zip.readUInt32LE(pos + 42);
    const name = zip.toString("utf8", pos + 46, pos + 46 + nameLen);
    entries.set(name, () => {
      const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
      const raw = zip.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return raw;
      if (method === 8) return inflateRawSync(raw);
      throw new Error(`Unsupported zip compression method ${method} for ${name}`);
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function csvFromZip(entries: Map<string, () => Buffer>, file: string): string {
  for (const [name, read] of entries) {
    if (name === file || name.endsWith(`/${file}`)) return read().toString("utf8");
  }
  throw new Error(`${file} not found in zip`);
}

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180: quoted fields, "" escapes, newlines inside quotes)
// ---------------------------------------------------------------------------

function* csvRows(text: string): Generator<string[]> {
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") yield row;
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    yield row;
  }
}

/** Iterate CSV records as header-keyed objects. */
function* csvRecords(text: string): Generator<Record<string, string>> {
  let header: string[] | null = null;
  for (const row of csvRows(text)) {
    if (!header) {
      header = row.map((h) => h.replace(/^\uFEFF/, ""));
      continue;
    }
    const rec: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) rec[header[i] as string] = row[i] ?? "";
    yield rec;
  }
}

// ---------------------------------------------------------------------------
// Transformation
// ---------------------------------------------------------------------------

/** Keep ~3 significant figures; plenty for nutrition and gram weights. */
function round(v: number): number {
  if (v >= 100) return Math.round(v);
  if (v >= 10) return Math.round(v * 10) / 10;
  return Math.round(v * 100) / 100;
}

/** Drop inch-dimension parentheticals ("(2-1/2" dia)") and collapse whitespace. */
function cleanLabel(raw: string): string {
  return raw
    .replace(/\([^)]*"[^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/[\s,]+$/, "")
    .trim()
    .toLowerCase();
}

function portionLabel(unitName: string, modifier: string, description: string): string | null {
  if (unitName in SKIPPED_UNITS) return null;
  const mod = cleanLabel(modifier || description);
  if (unitName === "undetermined") return mod || null;
  const base = UNIT_LABELS[unitName] ?? unitName.toLowerCase();
  return mod ? `${base}, ${mod}` : base;
}

interface BuiltFood {
  food: OutFood;
  categoryId: string;
}

function buildFoods(source: Source, entries: Map<string, () => Buffer>): BuiltFood[] {
  const wanted = new Map<string, { description: string; categoryId: string }>();
  for (const rec of csvRecords(csvFromZip(entries, "food.csv"))) {
    if (rec.data_type !== source.csvType) continue;
    if ((rec.food_category_id ?? "") in EXCLUDED_CATEGORIES) continue;
    const description = (rec.description ?? "")
      .replace(/\s*\(Includes foods for USDA's Food Distribution Program\)/i, "")
      .trim();
    // Foundation dry-bean entries are on a 0 % moisture basis, not as eaten.
    if (!description || description.includes("(0% moisture)")) continue;
    wanted.set(rec.fdc_id as string, { description, categoryId: rec.food_category_id ?? "" });
  }

  const nutrientValues = new Map<string, Map<number, number>>();
  for (const rec of csvRecords(csvFromZip(entries, "food_nutrient.csv"))) {
    const id = rec.fdc_id as string;
    if (!wanted.has(id) || !WANTED_NUTRIENT_IDS.has(rec.nutrient_id as string)) continue;
    const amount = Number.parseFloat(rec.amount ?? "");
    if (!Number.isFinite(amount)) continue;
    let byNutrient = nutrientValues.get(id);
    if (!byNutrient) nutrientValues.set(id, (byNutrient = new Map()));
    const nutrientId = Number(rec.nutrient_id);
    if (!byNutrient.has(nutrientId)) byNutrient.set(nutrientId, amount);
  }

  const units = new Map<string, string>();
  for (const rec of csvRecords(csvFromZip(entries, "measure_unit.csv"))) units.set(rec.id as string, (rec.name ?? "").trim());

  const portions = new Map<string, Portion[]>();
  for (const rec of csvRecords(csvFromZip(entries, "food_portion.csv"))) {
    const id = rec.fdc_id as string;
    if (!wanted.has(id)) continue;
    const gramWeight = Number.parseFloat(rec.gram_weight ?? "");
    const amount = Number.parseFloat(rec.amount ?? "");
    if (!(gramWeight > 0) || !(amount > 0)) continue;
    const label = portionLabel(units.get(rec.measure_unit_id ?? "") ?? "undetermined", rec.modifier ?? "", rec.portion_description ?? "");
    if (!label) continue;
    const list = portions.get(id) ?? [];
    const grams = round(gramWeight / amount);
    if (!list.some((p) => p.label === label && p.grams === grams)) list.push({ label, grams });
    portions.set(id, list);
  }

  const out: BuiltFood[] = [];
  for (const [id, { description, categoryId }] of wanted) {
    const values = nutrientValues.get(id);
    const per100g = {} as Nutrients;
    for (const key of NUTRIENT_KEYS) {
      let value: number | null = null;
      for (const nid of NUTRIENT_IDS[key]) {
        const v = values?.get(nid);
        if (v !== undefined) {
          value = round(Math.max(0, v));
          break;
        }
      }
      per100g[key] = value;
    }
    // Entries with no nutrient values at all cannot contribute to nutrition math.
    if (NUTRIENT_KEYS.every((key) => per100g[key] === null)) continue;
    out.push({
      categoryId,
      food: { fdcId: Number(id), description, dataType: source.dataType, per100g, portions: portions.get(id) ?? [] },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Borrowing portions: Foundation foods without portions take them from the closest SR Legacy food
// ---------------------------------------------------------------------------

/**
 * Preparation / preservation words, mapped to a state class. Two foods match only when their classes are equal:
 * raw carrots never borrow from cooked or canned carrots. No state word at all means "raw" (the plain food).
 */
const STATE_CLASS: Record<string, string> = {
  raw: "raw",
  fresh: "raw",
  unprepared: "raw",
  cooked: "cooked",
  boiled: "cooked",
  baked: "cooked",
  roasted: "cooked",
  fried: "cooked",
  steamed: "cooked",
  braised: "cooked",
  broiled: "cooked",
  grilled: "cooked",
  microwaved: "cooked",
  stewed: "cooked",
  sauteed: "cooked",
  simmered: "cooked",
  pan: "cooked",
  heated: "cooked",
  prepared: "cooked",
  canned: "canned",
  frozen: "frozen",
  dried: "dried",
  dehydrated: "dried",
  pickled: "pickled",
  smoked: "smoked",
  cured: "cured",
  toasted: "toasted",
};
/** Descriptive words that never separate two foods. */
const NOISE_WORDS: Record<string, true> = Object.fromEntries(
  [
    "and", "or", "with", "without", "the", "of", "in", "to", "added", "includes", "type", "style", "all", "purpose",
    "commercial", "commercially", "ns", "nfs", "usda", "year", "round", "average", "regular", "pack", "solid",
    "solids", "liquid", "liquids", "drained", "undrained", "from", "made", "ready", "serve", "packed", "salt", "water",
    "enriched", "unenriched", "fortified", "vitamin", "meat", "only", "trimmed", "separable", "bulk", "retail",
    "pasteurized", "organic", "boneless", "bone", "less", "than", "not", "no", "dry", "refrigerated", "shelf",
    "stable", "shelf-stable", "concentrate", "variety", "sodium", "rinsed", "mature", "seed", "fluid", "whipping",
    "cultured", "european", "peeled", "seeded", "dehusked", "destemmed", "removed", "root", "unsalted",
  ].map((word) => [word, true] as const),
);
/** Colour words. A source never borrows across different colours ("black" is not "white"). */
const COLOR_WORDS: Record<string, true> = Object.fromEntries(
  ["white", "red", "green", "yellow", "black", "brown", "purple", "pink", "dark", "light"].map((word) => [word, true] as const),
);
/** Source words the target may lack: "Wheat flour, white, ..." is plain "Flour, wheat, ...". At most one. */
const SOFT_WORDS: Record<string, true> = { white: true, ripe: true };

/** Fewest word overlap (Dice) a borrowed match may have. */
const BORROW_MIN_SCORE = 0.55;

/**
 * Hand-checked matches where the SR wording is too different for the rules (target description → SR description).
 * Each source must exist; the build fails otherwise.
 */
const BORROW_OVERRIDES: Record<string, string> = {
  "Tomato, roma": "Tomatoes, red, ripe, raw, year round average",
  "Lettuce, romaine, green, raw": "Lettuce, cos or romaine, raw",
  "Watermelon, seedless, flesh only, raw": "Watermelon, raw",
  "Peanut butter, creamy": "Peanut butter, smooth style, with salt",
  "Almond butter, creamy": "Nuts, almond butter, plain, without salt added",
  "Potatoes, russet, without skin, raw": "Potatoes, russet, flesh and skin, raw",
  "Potatoes, red, without skin, raw": "Potatoes, red, flesh and skin, raw",
  "Flour, bread, white, enriched, unbleached": "Wheat flour, white, bread, enriched",
  "Flour, whole wheat, unenriched": "Wheat flour, whole-grain",
  "Flour, semolina, fine": "Semolina, unenriched",
  "Flour, semolina, coarse and semi-coarse": "Semolina, unenriched",
  "Beans, black, canned, sodium added, drained and rinsed": "Beans, black turtle, mature seeds, canned",
  "Beans, cannellini, canned, sodium added, drained and rinsed": "Beans, white, mature seeds, canned",
  "Beans, cannellini, dry": "Beans, white, mature seeds, raw",
  "Blackeye pea, dry": "Cowpeas, common (blackeyes, crowder, southern), mature seeds, raw",
  "Blackeye pea, canned, sodium added, drained and rinsed": "Cowpeas, common (blackeyes, crowder, southern), mature seeds, canned, plain",
  "Cottage cheese, full fat, large or small curd": "Cheese, cottage, creamed, large or small curd",
  "Cheese, pasteurized process cheese food or product, American, singles": "Cheese, pasteurized process, American, without added vitamin D",
  "Cranberry juice, not fortified, from concentrate, shelf stable": "Cranberry juice, unsweetened",
  "Apple juice, with added vitamin C, from concentrate, shelf stable": "Apple juice, canned or bottled, unsweetened, with added ascorbic acid",
  "Grape juice, purple, with added vitamin C, from concentrate, shelf stable": "Grape juice, canned or bottled, unsweetened, with added ascorbic acid",
  "Grape juice, white, with added vitamin C, from concentrate, shelf stable": "Grape juice, canned or bottled, unsweetened, with added ascorbic acid",
  "Applesauce, unsweetened, with added vitamin C": "Applesauce, canned, unsweetened, with added ascorbic acid",
  "Tomato, paste, canned, without salt added": "Tomato products, canned, paste, without salt added",
  "Tomato, puree, canned": "Tomato products, canned, puree, without salt added",
  "Tomatoes, whole, canned, solids and liquids, with salt added": "Tomatoes, red, ripe, canned, packed in tomato juice",
  "Yogurt, plain, nonfat": "Yogurt, plain, skim milk",
  "Seeds, pumpkin seeds (pepitas), raw": "Seeds, pumpkin and squash seed kernels, dried",
  "Seeds, sunflower seed, kernel, raw": "Seeds, sunflower seed kernels, dried",
  "Nuts, pine nuts, raw": "Nuts, pine nuts, dried",
  "Nuts, brazilnuts, raw": "Nuts, brazilnuts, dried, unblanched",
  "Mushroom, crimini": "Mushrooms, brown, italian, or crimini, raw",
  "Squash, pie pumpkin, peeled, seeded, raw": "Pumpkin, raw",
  "Green onion, (scallion), bulb and greens, root removed, raw": "Onions, spring or scallions (includes tops and bulb), raw",
  "Leeks, bulb and greens, root removed, raw": "Leeks, (bulb and lower leaf-portion), raw",
  "Mango, Tommy Atkins, peeled, raw": "Mangos, raw",
  "Mandarin, seedless, peeled, raw": "Tangerines, (mandarin oranges), raw",
  "Plum, black, with skin, raw": "Plums, raw",
};

function stemWord(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ches|shes|oes|sses|xes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

interface Signature {
  /** Stemmed words of the first comma segment: the food's name ("spinach", "onion"). */
  head: Set<string>;
  /** Every content word (head included), noise and state words removed. */
  tokens: Set<string>;
  /** Sorted state classes joined, e.g. "canned" or "cooked,frozen". */
  state: string;
}

function signature(description: string): Signature {
  const segments = description
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/whole[- ](?:wheat|grain)/g, "wholegrain")
    .replace(/\b(?:sweet|bell) pepper/g, "pepper")
    .replace(/peppers, (?:sweet|bell)/g, "peppers")
    // "with skin", "includes skin", "meat and skin" are the food with its skin; a bare "skin" entry is only the skin.
    .replace(/\bwithout skin\b/g, "noskin")
    .replace(/\b(?:with|includes|and) skin\b/g, "withskin")
    .split(",")
    .map((segment) => segment.split(/[^a-z0-9%]+/).filter(Boolean).map(stemWord));
  const head = new Set(segments[0] ?? []);
  const tokens = new Set<string>();
  const states = new Set<string>();
  const isJuice = segments.some((tokens) => tokens.includes("juice"));
  for (const segment of segments) {
    for (const token of segment) {
      const cls = Object.hasOwn(STATE_CLASS, token) ? STATE_CLASS[token] : undefined;
      // SR files bottled juice as "canned or bottled"; Foundation says "shelf stable".
      if (cls !== undefined) {
        if (!(isJuice && cls === "canned")) states.add(cls);
      } else if (!Object.hasOwn(NOISE_WORDS, token) && !/^\d/.test(token)) tokens.add(token);
    }
  }
  // "red or green": the source names no single colour, so colour does not separate foods.
  if (/ or /.test(description.toLowerCase())) {
    const colors = [...tokens].filter((token) => Object.hasOwn(COLOR_WORDS, token));
    if (colors.length >= 2) for (const color of colors) tokens.delete(color);
  }
  if (states.size === 0) states.add("raw");
  return { head, tokens, state: [...states].sort().join(",") };
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return (2 * shared) / (a.size + b.size);
}

interface Candidate {
  food: OutFood;
  categoryId: string;
  sig: Signature;
}

/**
 * Closest SR Legacy food with portions. A source qualifies when it is the same food in the same form:
 * same category, same state class (raw, cooked, canned...), the target's name words all appear in the source,
 * and every other source word also appears in the target (so "Onions, raw" serves "Onions, white, raw",
 * while "Squash, zucchini" does not serve yellow squash). The best word overlap wins.
 * `null` when no candidate is a confident match.
 */
function closestPortionSource(target: Candidate, pool: Candidate[]): { source: Candidate; score: number } | null {
  let best: { source: Candidate; score: number } | null = null;
  for (const source of pool) {
    if (source.categoryId !== target.categoryId) continue;
    if (source.sig.state !== target.sig.state) continue;
    if (![...target.sig.head].every((token) => source.sig.tokens.has(token))) continue;
    if (![...source.sig.tokens].every((token) => target.sig.tokens.has(token) || Object.hasOwn(SOFT_WORDS, token))) continue;
    const targetColors = [...target.sig.tokens].filter((token) => Object.hasOwn(COLOR_WORDS, token));
    const sourceColors = [...source.sig.tokens].filter((token) => Object.hasOwn(COLOR_WORDS, token));
    if (targetColors.length > 0 && sourceColors.length > 0 && !sourceColors.some((token) => targetColors.includes(token))) continue;
    const softMissing = [...source.sig.tokens].filter((token) => !target.sig.tokens.has(token)).length;
    if (softMissing > 1) continue;
    const score = dice(target.sig.tokens, source.sig.tokens);
    if (score < BORROW_MIN_SCORE) continue;
    // Equal scores: the entry with more portions, then the lower id, for a stable result.
    const better =
      best === null ||
      score > best.score ||
      (score === best.score &&
        (source.food.portions.length > best.source.food.portions.length ||
          (source.food.portions.length === best.source.food.portions.length && source.food.fdcId < best.source.food.fdcId)));
    if (better) best = { source, score };
  }
  return best;
}

function borrowPortions(sr: BuiltFood[], foundation: BuiltFood[], report: boolean): void {
  const pool: Candidate[] = sr
    .filter((b) => b.food.portions.length > 0)
    .map((b) => ({ food: b.food, categoryId: b.categoryId, sig: signature(b.food.description) }));
  let borrowed = 0;
  const before = foundation.filter((b) => b.food.portions.length > 0).length;
  const byDescription = new Map(sr.map((b) => [b.food.description, b.food]));
  for (const built of foundation) {
    if (built.food.portions.length > 0) continue;
    const override = Object.hasOwn(BORROW_OVERRIDES, built.food.description)
      ? BORROW_OVERRIDES[built.food.description]
      : undefined;
    let source: OutFood | undefined;
    let score = 1;
    if (override !== undefined) {
      source = byDescription.get(override);
      if (!source || source.portions.length === 0) throw new Error(`Borrow override source missing: ${override}`);
    } else {
      const target: Candidate = { food: built.food, categoryId: built.categoryId, sig: signature(built.food.description) };
      const match = closestPortionSource(target, pool);
      source = match?.source.food;
      score = match?.score ?? 0;
    }
    if (!source) {
      if (report) console.log(`  none    ${built.food.description}`);
      continue;
    }
    built.food.portions = source.portions.map((p) => ({ label: p.label, grams: p.grams, estimated: true }));
    built.food.portionsFrom = source.fdcId;
    borrowed++;
    if (report) {
      console.log(
        `  ${score.toFixed(2)}  ${built.food.description}  <=  ${source.description}  [${source.portions.map((p) => p.label).join(" | ")}]`,
      );
    }
  }
  const total = foundation.length;
  console.log(`foundation foods with portions: ${before}/${total} before, ${before + borrowed}/${total} after borrowing`);
}

async function main(): Promise<void> {
  const report = process.argv.includes("--report");
  const built = new Map<DataType, BuiltFood[]>();
  for (const source of SOURCES) {
    const entries = readZipEntries(await fetchCached(source.url));
    const list = buildFoods(source, entries);
    console.log(`${source.dataType}: ${list.length} foods`);
    built.set(source.dataType, list);
  }
  borrowPortions(built.get("sr_legacy") ?? [], built.get("foundation") ?? [], report);
  const foods = [...built.values()].flatMap((list) => list.map((b) => b.food));
  foods.sort((a, b) => a.fdcId - b.fdcId);

  mkdirSync(path.dirname(outFile), { recursive: true });
  const gz = gzipSync(Buffer.from(JSON.stringify(foods)), { level: 9 });
  writeFileSync(outFile, gz);
  console.log(`Wrote ${foods.length} foods (${(gz.length / 1024).toFixed(0)} KiB) to ${path.relative(root, outFile)}`);
}

await main();
