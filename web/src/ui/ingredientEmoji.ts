import { EMOJI_ASSETS, type EmojiCode } from "./foodIcons";

/** "tomatoes" -> "tomato", "berries" -> "berry", "olives" -> "olive". */
function singular(w: string): string {
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (/(oes|ches|shes|sses)$/.test(w)) return w.slice(0, -2);
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter(Boolean).map(singular);

interface Candidate {
  name: EmojiCode;
  core: string[];
}

const INDEX: Candidate[] = Object.keys(EMOJI_ASSETS).map((name) => ({
  name,
  core: name.split("-").map(singular),
}));

/**
 * Curated overrides for names the icon files describe differently, checked
 * before name matching. Values are icon names.
 */
const ALIASES: ReadonlyArray<readonly [RegExp, EmojiCode]> = [
  [/scallion|green onion/, "spring-onion"],
  [/chicken (thigh|leg)|^chicken$/, "chicken-drumstick"],
  [/cayenne|chipotle/, "chili-powder"],
  [/coriander|spice/, "curry-powder"],
  [/cumin/, "cumin-seeds"],
  [/^(ground |whole )?cloves?$/, "whole-cloves"],
  [/cinnamon/, "cinnamon-sticks"],
  [/peppercorn|black pepper/, "black-peppercorns"],
  [/sesame/, "sesame-seeds"],
  [/^(white |jasmine |basmati |long.grain )?rice$/, "white-rice"],
  [/broth|stock/, "chicken-broth"],
  [/bread|toast|sourdough/, "bread-loaf"],
  [/brussel/, "cabbage"],
  [/squash/, "pumpkin-slice"],
  [/jalape|green chil/, "chili-pepper"],
  [/parmesan reggiano|mozzarella|feta/, "cheese"],
];

/** Fallback icon when nothing matches. */
export const DEFAULT_ICON: EmojiCode = "empty-bowl";

/** A custom icon is an http(s) URL; anything else is a bundled icon name. */
export function isImageUrl(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && /^https?:\/\//i.test(value);
}

const cache = new Map<string, EmojiCode>();

/**
 * Icon for an ingredient name: an alias, else the icon whose name words all
 * appear in the ingredient (most words first, then one naming the last word of
 * the ingredient, so "apple cider vinegar" is vinegar), else `DEFAULT_ICON`.
 */
function automaticIcon(name: string): EmojiCode {
  const hit = cache.get(name);
  if (hit) return hit;
  const lower = name.toLowerCase();
  const alias = ALIASES.find(([re]) => re.test(lower))?.[1];
  if (alias) {
    cache.set(name, alias);
    return alias;
  }
  const list = words(name);
  const have = new Set(list);
  const last = list[list.length - 1];
  const rank = (c: Candidate) => c.core.length * 1000 + (c.core[c.core.length - 1] === last ? 100 : 0);
  let best: Candidate | undefined;
  for (const c of INDEX) {
    if (c.core.length === 0 || !c.core.every((w) => have.has(w))) continue;
    if (!best || rank(c) > rank(best)) best = c;
  }
  const found = best?.name ?? DEFAULT_ICON;
  cache.set(name, found);
  return found;
}

/**
 * Icon to show for an ingredient: an http(s) URL passes through, a bundled
 * icon name wins, otherwise the name matcher decides.
 */
export function ingredientEmoji(name: string, imageUrl?: string | null): EmojiCode {
  if (isImageUrl(imageUrl)) return imageUrl;
  if (imageUrl !== null && imageUrl !== undefined && imageUrl in EMOJI_ASSETS) return imageUrl;
  return automaticIcon(name);
}

/** True when the ingredient has a visible icon rather than the fallback bowl. */
export function hasIcon(name: string, imageUrl: string | null): boolean {
  return ingredientEmoji(name, imageUrl) !== DEFAULT_ICON;
}
