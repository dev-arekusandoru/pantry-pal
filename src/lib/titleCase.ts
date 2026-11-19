/** Words that stay lowercase in an ingredient name unless they are the first word. */
const SMALL_WORDS: Record<string, true> = {
  a: true,
  an: true,
  and: true,
  as: true,
  at: true,
  for: true,
  in: true,
  of: true,
  on: true,
  or: true,
  the: true,
  to: true,
  with: true,
};

function capitalizePart(part: string): string {
  // The first letter or digit takes the capital; the rest is lowercase ("mom's" → "Mom's").
  const first = part.search(/[\p{L}\p{N}]/u);
  if (first === -1) return part;
  return `${part.slice(0, first)}${part.charAt(first).toUpperCase()}${part.slice(first + 1).toLowerCase()}`;
}

/** A part the user typed with an own capital inside ("BBQ", "McCormick") stays as typed. */
function hasInnerUppercase(part: string): boolean {
  const first = part.search(/[\p{L}\p{N}]/u);
  return first !== -1 && /\p{Lu}/u.test(part.slice(first + 1));
}

/**
 * The canonical ingredient name style: Title Case.
 * Each word, and each part of a hyphenated word, starts with a capital ("Sun-Dried Tomatoes").
 * After the first word, a, an, and, as, at, for, in, of, on, or, the, to and with stay lowercase.
 * A word with a capital after its first character stays as typed ("BBQ Sauce", "McCormick").
 * Whitespace is trimmed and collapsed. The function is idempotent.
 */
export function titleCaseName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && Object.hasOwn(SMALL_WORDS, lower)) return lower;
      return word
        .split("-")
        .map((part) => (hasInnerUppercase(part) ? part : capitalizePart(part)))
        .join("-");
    })
    .join(" ");
}
