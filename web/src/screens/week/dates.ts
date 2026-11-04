/**
 * Calendar-date helpers. Dates are `YYYY-MM-DD` strings with no timezone: the
 * server's plan days are plain dates, and "today" is the browser's local date.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The browser's local calendar date. */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function addDays(date: string, n: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(date: string): number {
  return toUtc(date).getUTCDay();
}

/** First day of the week containing `date`; `weekStartsOn` is 0 = Sunday ... 6 = Saturday. */
export function weekStartFor(date: string, weekStartsOn: number): string {
  const start = ((Math.trunc(weekStartsOn) % 7) + 7) % 7;
  return addDays(date, -((weekdayOf(date) - start + 7) % 7));
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function weekdayName(date: string, style: "long" | "short" = "long"): string {
  return toUtc(date).toLocaleDateString(undefined, { weekday: style, timeZone: "UTC" });
}

/** "Nov 2" */
export function monthDay(date: string): string {
  return toUtc(date).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Mon Nov 2 to Sun Nov 8" */
export function weekRange(weekStart: string): string {
  const end = addDays(weekStart, 6);
  return `${weekdayName(weekStart, "short")} ${monthDay(weekStart)} to ${weekdayName(end, "short")} ${monthDay(end)}`;
}
