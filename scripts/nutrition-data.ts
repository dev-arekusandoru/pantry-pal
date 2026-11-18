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

function buildFoods(source: Source, entries: Map<string, () => Buffer>): OutFood[] {
  const wanted = new Map<string, { description: string }>();
  for (const rec of csvRecords(csvFromZip(entries, "food.csv"))) {
    if (rec.data_type !== source.csvType) continue;
    if ((rec.food_category_id ?? "") in EXCLUDED_CATEGORIES) continue;
    const description = (rec.description ?? "")
      .replace(/\s*\(Includes foods for USDA's Food Distribution Program\)/i, "")
      .trim();
    // Foundation dry-bean entries are on a 0 % moisture basis, not as eaten.
    if (!description || description.includes("(0% moisture)")) continue;
    wanted.set(rec.fdc_id as string, { description });
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

  const out: OutFood[] = [];
  for (const [id, { description }] of wanted) {
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
    out.push({ fdcId: Number(id), description, dataType: source.dataType, per100g, portions: portions.get(id) ?? [] });
  }
  return out;
}

async function main(): Promise<void> {
  const foods: OutFood[] = [];
  for (const source of SOURCES) {
    const entries = readZipEntries(await fetchCached(source.url));
    const built = buildFoods(source, entries);
    console.log(`${source.dataType}: ${built.length} foods`);
    foods.push(...built);
  }
  foods.sort((a, b) => a.fdcId - b.fdcId);

  mkdirSync(path.dirname(outFile), { recursive: true });
  const gz = gzipSync(Buffer.from(JSON.stringify(foods)), { level: 9 });
  writeFileSync(outFile, gz);
  console.log(`Wrote ${foods.length} foods (${(gz.length / 1024).toFixed(0)} KiB) to ${path.relative(root, outFile)}`);
}

await main();
