import type { Ctx } from "../context.js";
import { AppError } from "../lib/errors.js";

export interface SeedResult {
  summary: Record<string, number>;
}

/**
 * STUB: the seed loader is not implemented yet. A later agent implements it
 * (pantry items, recipes, rules, plans…) and keeps this signature.
 */
export function loadSeed(_ctx: Ctx, _data: unknown): SeedResult {
  throw new AppError("unprocessable", "seed loader not implemented");
}
