import type { Ctx } from "../context.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ISO-8601 timestamp for "now" on the request context. */
export function nowIso(ctx: Ctx): string {
  return ctx.now().toISOString();
}

/** Current calendar date (YYYY-MM-DD) as seen by the context clock (UTC). */
export function todayIn(ctx: Ctx): string {
  return isoDate(ctx.now());
}

/** Calendar date (YYYY-MM-DD) of a Date, in UTC. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Strict `YYYY-MM-DD` check (rejects impossible dates such as 2026-02-31). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && isoDate(parsed) === value;
}

/** Shift a `YYYY-MM-DD` date by `n` days (negative moves backwards). */
export function addDays(date: string, n: number): string {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + n);
  return isoDate(base);
}

/** Day of week (0 = Sunday … 6 = Saturday) for a `YYYY-MM-DD` date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

/** First day of the week containing `date`, where `weekStartsOn` is 0 = Sunday … 6 = Saturday. */
export function weekStartFor(date: string, weekStartsOn: number): string {
  const start = ((Math.trunc(weekStartsOn) % 7) + 7) % 7;
  const diff = (weekdayOf(date) - start + 7) % 7;
  return addDays(date, -diff);
}

/** Number of whole days between two `YYYY-MM-DD` dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const from = new Date(`${a}T00:00:00.000Z`).getTime();
  const to = new Date(`${b}T00:00:00.000Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}
