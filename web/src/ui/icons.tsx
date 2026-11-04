import type { ReactNode, SVGProps } from "react";

/**
 * Stroke icon set (24x24 viewBox, 2.1 stroke, round caps), taken from the Glaze
 * mockup plus a few additions. Icons inherit `currentColor` and size at 1.1em, so
 * they scale with the surrounding text; override with `size` or CSS width/height.
 */
const paths = {
  week: <><rect x="3.5" y="5" width="17" height="15" rx="3.5" /><path d="M8 3v4M16 3v4M3.5 10h17" /></>,
  shop: <><path d="M4 9h16l-1.6 9.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8L4 9Z" /><path d="M8.5 9l2.5-4.5M15.5 9 13 4.5" /></>,
  pantry: <><path d="M8 3.5h8v3H8zM6.5 6.5h11v2.2c.9.9 1.5 2 1.5 3.3v6a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18v-6c0-1.3.6-2.4 1.5-3.3V6.5Z" /><path d="M5 13h14" /></>,
  recipes: <path d="M12 6.5C10.5 5 8 4.5 4.5 4.5v13c3.5 0 6 .5 7.5 2 1.5-1.5 4-2 7.5-2v-13c-3.5 0-6 .5-7.5 2ZM12 6.5v13" />,
  settings: <><path d="M4 7h9M19 7h1M4 17h1M11 17h9" /><circle cx="16" cy="7" r="2.6" /><circle cx="8" cy="17" r="2.6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  back: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  people: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c.6-3.3 2.9-5 5.5-5s4.9 1.7 5.5 5M16 5.6a3.2 3.2 0 0 1 0 5.8M18.5 14.9c1.4.7 2.5 2.2 3 4.6" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  leftover: <path d="M5 11h14l-1.2 7.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 11ZM4 11h16M7 11l1-3h8l1 3" />,
  flame: <path d="M12 3c.5 3-3 4.5-3 8a3 3 0 0 0 6 0c0-1-.4-1.8-1-2.5 2.8 1 4.5 3.3 4.5 6.1A6.6 6.6 0 0 1 12 21a6.6 6.6 0 0 1-6.5-6.4C5.5 9 10 7 12 3Z" />,
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  timer: <><circle cx="12" cy="13.5" r="7" /><path d="M12 10v3.5l2 1.5M9.5 3h5" /></>,
  swap: <path d="M7 4 3.5 7.5 7 11M3.5 7.5H18M17 13l3.5 3.5L17 20M20.5 16.5H6" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 6M20 4v7h-7" />,
  undo: <path d="M9 5 4 10l5 5M4 10h10a5.5 5.5 0 0 1 0 11h-4" />,
  trash: <path d="M5 7h14M10 7V4.5h4V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" />,
  alert: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5M12 16h.01" /></>,
  offline: <path d="M2 8.8a15 15 0 0 1 4-2.4M22 8.8a15 15 0 0 0-9-3.7M5 12.5a10 10 0 0 1 3-2M19 12.5a10 10 0 0 0-3.5-2.4M8.5 16a5 5 0 0 1 4-1.5M12 19.5h.01M3 3l18 18" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "children"> {
  name: IconName;
  /** CSS size (number = px). Defaults to 1.1em. */
  size?: number | string;
}

export function Icon({ name, size, style, ...rest }: IconProps) {
  const s = typeof size === "number" ? `${size}px` : (size ?? "1.1em");
  return (
    <svg
      viewBox="0 0 24 24"
      width={s}
      height={s}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "none", ...style }}
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
