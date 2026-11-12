/**
 * Where a cook left off, per recipe, kept in localStorage so closing cook mode
 * (or the tab) doesn't lose the place. Timers are deliberately not persisted.
 */

import { MAX_COOKS, type Crew } from "./crew";

export interface CookProgress {
  /** Zero-based step index. */
  step: number;
  /** Steps when saved; a changed recipe must not resume into the wrong place. */
  stepCount: number;
  servings: number;
  /** Planned cook the progress belongs to, when there was one. */
  cookEvent?: string;
  /** Cook crew and their places, when cooking as more than one person. */
  crew?: Crew;
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

/** A saved crew must still describe this exact recipe; anything else is dropped. */
function isCrew(value: unknown, stepCount: number): value is Crew {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.cooks) || v.cooks.length < 2 || v.cooks.length > MAX_COOKS) return false;

  const ids = new Set<string>();
  for (const value of v.cooks) {
    if (typeof value !== "object" || value === null) return false;
    const cook = value as Record<string, unknown>;
    if (typeof cook.id !== "string" || cook.id === "" || ids.has(cook.id)) return false;
    if (typeof cook.name !== "string" || cook.name === "") return false;
    ids.add(cook.id);
  }

  if (!Array.isArray(v.owners) || v.owners.length !== stepCount) return false;
  if (!v.owners.every((owner) => typeof owner === "string" && ids.has(owner))) return false;
  if (typeof v.positions !== "object" || v.positions === null || Array.isArray(v.positions)) return false;

  for (const [id, position] of Object.entries(v.positions)) {
    if (!ids.has(id)) return false;
    if (!Number.isInteger(position) || (position as number) < 0) return false;
  }
  return true;
}

/** Valid progress, with an unusable crew dropped so the rest still resumes. */
function sanitizeProgress(value: unknown): CookProgress | null {
  if (!isProgress(value)) return null;
  const progress = { ...value };
  if (progress.crew !== undefined && !isCrew(progress.crew, progress.stepCount)) delete progress.crew;
  return progress;
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
      const progress = sanitizeProgress(value);
      if (progress !== null) store[slug] = progress;
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

/**
 * A saved position is only resumable while the recipe still has those steps.
 * A crew counts as under way once any cook has moved off their first step.
 */
export function isResumable(progress: CookProgress | null, stepCount: number): progress is CookProgress {
  if (progress === null || progress.stepCount !== stepCount) return false;
  const crewStarted = progress.crew !== undefined && Object.values(progress.crew.positions).some((p) => p > 0);
  return crewStarted || (progress.step > 0 && progress.step < stepCount);
}
