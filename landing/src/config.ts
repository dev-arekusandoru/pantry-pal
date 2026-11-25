// One place for the facts the page repeats: prices, trial, links.
// Prices are placeholders until billing exists (see BACKLOG.md, Launch readiness).

const monthly = 3.99;
const yearly = 39;

export const money = (amount: number) =>
  Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;

export const site = {
  name: "Rakumi",
  tagline: "Dinner for the whole week, sorted in seconds.",
  description:
    "Rakumi is an open-source kitchen companion. Plan meals, track your pantry, keep your recipes, cook step by step, and shop from one list.",
  trialDays: 14,
  price: {
    monthly,
    yearly,
    yearlyPerMonth: yearly / 12,
    freeMonths: Math.floor(12 - yearly / monthly),
  },
  links: {
    github: "https://github.com/dev-arekusandoru/pantry-pal",
    docs: "https://dev-arekusandoru.github.io/pantry-pal/",
    selfHost: "https://dev-arekusandoru.github.io/pantry-pal/start/install",
    privacy: "/privacy",
    terms: "/terms",
    contact: "/contact",
  },
  // Product support address (Cloudflare Email Routing forwards it).
  contactEmail: "support@rakumi.app",
  // Who runs the hosted service; named in the Privacy Policy and Terms.
  operator: "Alexandru Muresan",
  // Date the Privacy Policy and Terms last changed. Update it with every change.
  legalUpdated: "2026-11-24",
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
