import type { SVGProps } from "react";
import {
  ArrowUUpLeft,
  ArrowsClockwise,
  ArrowsLeftRight,
  BookOpenText,
  BowlFood,
  CalendarDots,
  CaretLeft,
  Check,
  Clock,
  CloudSlash,
  Fire,
  GearSix,
  Jar,
  ListBullets,
  MagnifyingGlass,
  Minus,
  Moon,
  Plus,
  ShoppingCartSimple,
  Sun,
  Timer,
  Trash,
  Users,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon, IconWeight } from "@phosphor-icons/react";

/**
 * Phosphor icons (https://phosphoricons.com) in the bold weight, matching the
 * chunky Glaze look. Each icon is imported by name so the bundler keeps only
 * the ones we use. Icons inherit `currentColor` and size at 1.1em by default.
 */
const ICONS = {
  week: CalendarDots,
  shop: ShoppingCartSimple,
  pantry: Jar,
  recipes: BookOpenText,
  settings: GearSix,
  plus: Plus,
  minus: Minus,
  back: CaretLeft,
  close: X,
  clock: Clock,
  people: Users,
  check: Check,
  search: MagnifyingGlass,
  sun: Sun,
  moon: Moon,
  leftover: BowlFood,
  flame: Fire,
  list: ListBullets,
  timer: Timer,
  swap: ArrowsLeftRight,
  refresh: ArrowsClockwise,
  undo: ArrowUUpLeft,
  trash: Trash,
  alert: WarningCircle,
  offline: CloudSlash,
} satisfies Record<string, PhosphorIcon>;

export type IconName = keyof typeof ICONS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "children"> {
  name: IconName;
  /** CSS size (number = px). Defaults to 1.1em. */
  size?: number | string;
  /** Phosphor stroke weight. Defaults to bold to match the UI's heavy outlines. */
  weight?: IconWeight;
}

export function Icon({ name, size = "1.1em", weight = "bold", style, ...rest }: IconProps) {
  const Cmp = ICONS[name];
  return (
    <Cmp
      size={size}
      weight={weight}
      aria-hidden="true"
      focusable="false"
      style={{ flex: "none", ...style }}
      {...rest}
    />
  );
}
