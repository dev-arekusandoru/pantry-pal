/**
 * Food icons: every WebP in `assets/ingredients/`, keyed by file name without
 * the extension (e.g. `t-bone-steak`, `garlic`). Vite hashes and copies
 * the files. To add an icon, drop a descriptive WebP in that folder;
 * `ingredientEmoji` finds it by name.
 */
const files = import.meta.glob<string>("../assets/ingredients/*.webp", { eager: true, import: "default", query: "?url" });

export const EMOJI_ASSETS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -5), url]),
);

/** Icon name: a key of `EMOJI_ASSETS`. */
export type EmojiCode = string;

/** Asset URL for an icon name; an http(s) URL is already an image source. */
export function emojiSrc(code: EmojiCode): string {
  return /^https?:\/\//i.test(code) ? code : EMOJI_ASSETS[code]!;
}
