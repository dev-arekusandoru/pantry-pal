/**
 * Where a cook left off, per recipe, kept in localStorage so closing cook mode
 * (or the tab) doesn't lose the place. Timers are deliberately not persisted.
 */

export interface CookProgress {
  /** Zero-based step index. */
  step: number;
  /** Steps when saved; a changed recipe must not resume into the wrong place. */
  stepCount: number;
  servings: number;
  /** Planned cook the progress belongs to, when there was one. */
  cookEvent?: string;
  savedAt: string;
}

const STORAGE_KEY = "pantrypal.cook-progress.v1";

type Store = Record<string, CookProgress>;

function isProgress(value: unknown): value is CookProgress {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Number.isInteger(v.step) &&
    (v.step as number) >= 0 &&
    Number.isInteger(v.stepCount) &&
    (v.stepCount as number) > 0 &&
    typeof v.servings === "number" &&
    Number.isFinite(v.servings) &&
    v.servings > 0 &&
    (v.cookEvent === undefined || (typeof v.cookEvent === "string" && v.cookEvent !== "")) &&
    typeof v.savedAt === "string"
  );
}

function readStore(): Store {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const store: Store = {};
    for (const [slug, value] of Object.entries(parsed)) {
      if (isProgress(value)) store[slug] = value;
    }
    return store;
  } catch {
    // Corrupt or unavailable storage: treat as no progress.
    return {};
  }
}

function writeStore(store: Store): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota or private mode: resuming is a nicety, never block cooking.
  }
}

/** The saved progress for a recipe, or null. */
export function readCookProgress(slug: string): CookProgress | null {
  return readStore()[slug] ?? null;
}

export function saveCookProgress(slug: string, progress: CookProgress): void {
  const store = readStore();
  store[slug] = progress;
  writeStore(store);
}

export function clearCookProgress(slug: string): void {
  const store = readStore();
  if (store[slug] === undefined) return;
  delete store[slug];
  writeStore(store);
}

/** A saved position is only resumable while the recipe still has those steps. */
export function isResumable(progress: CookProgress | null, stepCount: number): progress is CookProgress {
  return (
    progress !== null &&
    progress.stepCount === stepCount &&
    progress.step > 0 &&
    progress.step < stepCount
  );
}
