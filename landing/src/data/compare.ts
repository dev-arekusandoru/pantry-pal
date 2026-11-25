import { money, site } from "../config";

// Facts about other products were checked on 2026-11-19 against their own
// sites and docs. "no" means we did not find it, not that it is absent.
export const compareCheckedOn = "Nov 19, 2026";

export type Cell =
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "text"; text: string } // "\n" starts a new line
  | { kind: "soon"; note?: string };

export const products = ["Rakumi", "Plan to Eat", "Paprika", "Mealie"] as const;

export interface Row {
  label: string;
  hint?: string;
  /** One cell per product, in `products` order. */
  cells: [Cell, Cell, Cell, Cell];
}

const yes: Cell = { kind: "yes" };
const no: Cell = { kind: "no" };
const text = (value: string): Cell => ({ kind: "text", text: value });
const soon = (note?: string): Cell => ({ kind: "soon", note });

export const rows: Row[] = [
  {
    label: "Cook together",
    hint: "Split a recipe's steps between 2 to 4 cooks",
    cells: [yes, no, no, no],
  },
  {
    label: "Missions and a sticker book",
    hint: "Weekly goals, a treat stamp, ingredient stickers",
    cells: [yes, no, no, no],
  },
  {
    label: "Shopping list minus your pantry",
    hint: "Only buy the gaps",
    cells: [yes, no, no, no],
  },
  {
    label: "Pantry with expiration dates",
    cells: [yes, text("Dropped on purpose"), yes, no],
  },
  { label: "Save recipes from a link", cells: [yes, yes, yes, yes] },
  {
    label: "Cook mode with timers",
    cells: [yes, yes, yes, text("Keeps the screen on")],
  },
  {
    label: "Nutrition from USDA data",
    cells: [yes, text("Yes, plus macros"), text("Yes, in Premium"), text("Typed in by hand")],
  },
  {
    label: "AI assistant (MCP)",
    cells: [yes, no, no, text("Third-party only")],
  },
  {
    label: "Open source, free to self-host",
    cells: [text("MIT"), no, no, text("AGPL-3.0")],
  },
  {
    label: "Price",
    hint: "We run it for you",
    cells: [
      text(`${money(site.price.monthly)} / month`),
      text("$5.95 / month\nor $49 / year"),
      text("Free up to 50 recipes, then Premium"),
      text("Free to self-host"),
    ],
  },
  {
    label: "Mobile app",
    cells: [soon("Works great in your phone's browser"), yes, yes, no],
  },
  {
    label: "Voice control while cooking",
    cells: [soon(), no, yes, no],
  },
  {
    label: "Barcode scanning for your pantry",
    cells: [soon(), no, text("Yes, in Premium"), no],
  },
];
