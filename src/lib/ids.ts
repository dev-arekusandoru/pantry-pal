import { randomBytes } from "node:crypto";

/** Lowercase base32 (RFC 4648 alphabet, no padding). 32 divides 256 evenly. */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const BODY_LENGTH = 16;

/**
 * Random prefixed identifier, e.g. `newId("ing")` → `ing_8f3k2m9p0q1r2s3t`.
 *
 * Prefixes used across the schema: hh, mem, tok, ing, ali, uc, pi, mv, rcp, ri,
 * rs, rse, rule, plan, ce, slot, prep, sl, sli.
 */
export function newId(prefix: string): string {
  const bytes = randomBytes(BODY_LENGTH);
  let body = "";
  for (let i = 0; i < BODY_LENGTH; i++) {
    body += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${prefix}_${body}`;
}
