/** Timer durations for recipe steps: the structured field first, then text like "10 minutes" / "1-2 hours". */

const UNICODE_FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };

const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?[½¼¾⅓⅔]?|[½¼¾⅓⅔])`;
const UNIT = String.raw`(hours?|hrs?|minutes?|mins?|seconds?|secs?)`;
const DURATION = new RegExp(String.raw`(${NUM})(?:\s*(?:-|–|—|to)\s*(${NUM}))?\s*(?:-\s*)?${UNIT}\b`, "i");

function parseNumber(token: string): number {
  const t = token.trim();
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const last = t.slice(-1);
  const glyph = UNICODE_FRACTIONS[last];
  if (glyph !== undefined) return (t.length > 1 ? Number(t.slice(0, -1)) : 0) + glyph;
  return Number(t);
}

const MAX_SECONDS = 24 * 3600;

/**
 * First duration in free text, in seconds. A range ("5-6 hours") uses its upper
 * bound, matching how structured durations are stored. Null when none is found.
 */
export function parseDurationSeconds(text: string): number | null {
  const m = DURATION.exec(text);
  if (!m) return null;
  const [, lo, hi, unit] = m;
  const amount = parseNumber(hi ?? lo ?? "");
  const perUnit = /^h/i.test(unit ?? "") ? 3600 : /^m/i.test(unit ?? "") ? 60 : 1;
  const seconds = Math.round(amount * perUnit);
  return seconds > 0 && seconds <= MAX_SECONDS ? seconds : null;
}

/** Timer length for a step in seconds, or null when the step has no duration. */
export function stepSeconds(step: { text: string; durationMinutes: number | null }): number | null {
  if (step.durationMinutes !== null && step.durationMinutes > 0) return Math.round(step.durationMinutes * 60);
  return parseDurationSeconds(step.text);
}

/** 90 -> "1:30", 3725 -> "1:02:05". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** 600 -> "10 min", 3600 -> "1 hr", 45 -> "45 sec". */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} sec`;
  const min = Math.round(totalSeconds / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}
