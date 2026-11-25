import type { ImageMetadata } from "astro";
import week from "../assets/img/week.webp";
import shop from "../assets/img/shop.webp";
import cook from "../assets/img/cook.webp";
import pantry from "../assets/img/pantry.webp";
import egg from "../assets/icons/egg.webp";
import carrot from "../assets/icons/carrot.webp";
import garlic from "../assets/icons/garlic.webp";
import milk from "../assets/icons/milk.webp";

export interface Step {
  title: string;
  text: string;
  image: ImageMetadata;
  imageAlt: string;
  /** CSS object-position that crops the screenshot to the useful part. */
  crop: string;
  icon: ImageMetadata;
  /** App tab whose color tints the card. */
  tab: "week" | "shop" | "settings" | "pantry";
}

export const steps: Step[] = [
  {
    title: "Plan the week",
    text: "Drop meals onto your days. Cooking once and eating twice? Leftovers go in the plan too.",
    image: week,
    imageAlt: "The week view with breakfast, lunch and dinner, and a leftovers label",
    crop: "30% 40%",
    icon: egg,
    tab: "week",
  },
  {
    title: "Shop for the gaps",
    text: "Your list comes from the plan, minus what's already in the pantry. Grouped by aisle, ready to tick off.",
    image: shop,
    imageAlt: "Shopping list grouped into produce, meat and fish, and dairy",
    crop: "40% 20%",
    icon: carrot,
    tab: "shop",
  },
  {
    title: "Cook step by step",
    text: "Big, easy-to-read steps and built-in timers. Cooking with someone? Split the steps between you.",
    image: cook,
    imageAlt: "Cook mode with a large recipe step and a timer",
    crop: "50% 40%",
    icon: garlic,
    tab: "settings",
  },
  {
    title: "Your pantry keeps up",
    text: "Finish a recipe and your stock updates. Expiration dates keep you using things up in time.",
    image: pantry,
    imageAlt: "Pantry tiles with amounts and plus and minus buttons",
    crop: "40% 20%",
    icon: milk,
    tab: "pantry",
  },
];
