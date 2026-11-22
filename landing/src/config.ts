// One place for the facts the page repeats: prices, trial, links.
// Prices are placeholders until billing exists (see BACKLOG.md, Launch readiness).

const monthly = 3.99;
const yearly = 39;

export const money = (amount: number) =>
  Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;

export const site = {
  name: "Rakumi",
  tagline: "Dinner, figured out.",
  description:
    "Rakumi is an open-source kitchen companion. Plan meals, track your pantry, keep your recipes, cook step by step, and shop from one list.",
  trialDays: 14,
  price: {
    monthly,
    yearly,
    yearlySaving: Math.round(monthly * 12 - yearly),
  },
  links: {
    github: "https://github.com/dev-arekusandoru/pantry-pal",
    docs: "https://dev-arekusandoru.github.io/pantry-pal/",
    selfHost: "https://dev-arekusandoru.github.io/pantry-pal/start/install",
    // Legal pages and the contact address do not exist yet. Links with an empty
    // href are left out of the footer.
    privacy: "",
    terms: "",
    contact: "",
  },
  // URL of the waitlist Worker (see docs/host/waitlist.md). The form posts
  // `{ email, website }` as JSON; any 2xx is success. Empty means the waitlist is
  // not wired up, and the form says so.
  waitlistEndpoint: "https://pantrypal-waitlist.pantrypal-waitlist.workers.dev",
  // Where the hosted app signs people up, for example "https://app.rakumi.app/".
  // Empty (the default) means the hosted app is not open: every button reads
  // "Join the waitlist" and goes to the waitlist form. Set it when sign-up opens:
  // the buttons read "Start your free trial" and go to this URL, and the
  // waitlist form is hidden.
  signupUrl: "" as string,
} as const;

// The main call to action, chosen by `site.signupUrl`.
export const cta = site.signupUrl
  ? { open: true, href: site.signupUrl, label: "Start your free trial" }
  : { open: false, href: "#join", label: "Join the waitlist" };
