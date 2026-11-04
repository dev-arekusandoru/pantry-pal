# PantryPal web frontend: plan

Status: direction chosen (**Glaze**, with dark mode). Reference mockups live in
[`mockups/glaze.html`](../mockups/glaze.html) (open in a browser; it uses `app.js` + `data.js`, which is
generated from the seed). The mockup is a frozen reference for look and feel, not a spec for behavior.
The rejected editorial direction was removed.

## What it is for

Primary user is a household member cooking and shopping from a phone, not an admin. Open-source
self-hosters are a secondary audience, so setup and polish matter, but the household comes first.

Jobs, in priority order:

1. **Shop in the store.** One-handed check-off against a list generated from the plan.
2. **Keep the pantry honest.** Quick add and quick +/- edits.
3. **Read a recipe at a glance**, scaled to the servings wanted, with a clear "what am I missing".
4. **Cook step by step.** Big text, one step at a time, timers, screen stays awake.
5. **See and adjust the week.** Whatever the agent planned over MCP must be visible and easy to
   change by hand. The UI is a full peer of the agent, not a viewer.

Non-goals for v1: offline support, multi-user accounts, recipe editing forms, analytics.

## Stack

| Area | Choice | Why |
|---|---|---|
| Build | Vite + TypeScript | Static output, trivial to serve from the existing Hono process |
| UI | React 19 | Largest contributor pool for an open-source project |
| Routing | TanStack Router | Typed routes; recipe and cook mode are real URLs (deep-linkable, back button works) |
| Server state | TanStack Query | Caching, optimistic updates for check-offs and stock edits |
| API client | `openapi-typescript` + `openapi-fetch` generated from `/openapi.json` | Types come from the Zod routes, so there is no hand-written client to drift |
| Styling | Plain CSS with design tokens (CSS variables), CSS modules per component | The two mockups are token-driven, so the final theme is a token file. Avoids a utility framework fighting a distinctive design |
| Icons | Inline SVG set (stroke icons, as in the mockups) | No icon-font dependency |
| Tests | Vitest + Testing Library, a few Playwright smoke flows | Shop check-off, pantry adjust, cook mode |

Layout in the repo: `web/` as a pnpm workspace package. `pnpm build` produces `web/dist`, which the
server serves at `/` with an SPA fallback. The Docker image stays a single container. In dev, Vite
proxies `/api` to the Hono server.

Development:

- `PANTRYPAL_TRUST_NETWORK=1 pnpm dev` (API) plus `pnpm web:dev` (Vite on :5173, proxies `/api` and
  `/health` to `127.0.0.1:8787`, or `PANTRYPAL_API_URL`).
- `pnpm openapi` regenerates `web/openapi.json` and `web/src/api/schema.d.ts` after API changes.
- `pnpm build` builds server and web; `pnpm typecheck` covers both; `pnpm test` (backend),
  `pnpm test:web`, `pnpm test:all`.
- Screens live in `web/src/screens/<name>/`, shared primitives in `web/src/ui/`, tokens in
  `web/src/styles/tokens.css`.

## Serving and auth (v1)

- The browser calls `/api/v1/*` same-origin, so no CORS.
- **Auth is network access.** If you can reach the app, you are in. The household reaches it over the
  tailnet via `tailscale serve --bg 8787` on the host, which gives an `https://<box>.<tailnet>.ts.net`
  URL. HTTPS matters: the screen wake lock in cook mode only works in a secure context. Real web auth
  is in `BACKLOG.md`.
- **Server change:** opt-in `PANTRYPAL_TRUST_NETWORK=1`. When on, `/api/v1/*` requests without a bearer
  token act as the instance's single household; a token, if sent, is still verified. Default off,
  never applies to `/mcp`. Agents keep using tokens.
- The app shows a clear "can't reach PantryPal" state instead of a login screen.

## Screens

Mobile nav is a five-item bar (Week, Shop, Pantry, Recipes, Settings); tablet and desktop get a left
rail. Recipe and cook mode are routes layered over the tabs.

| Route | Screen | Core behavior | API |
|---|---|---|---|
| `/` | Week | "Dinner tonight" card, next prep nudge, day-by-day slots with leftover markers, empty slots offer "plan something", every slot can be swapped (see below). No plan this week: a friendly empty state prompting to plan the week | `GET /plans/current`, `GET /prep-tasks`, `POST /plans/:id/swap` |
| `/shop` | Shopping | The current week's list by default, with a picker for other open lists. Aisle groups, big tap rows, progress, add by hand, "Done shopping" turns checked items into pantry stock | `GET /shopping-lists`, `POST .../check`, `POST .../items`, `POST .../complete` |
| `/pantry` | Pantry | Search, location filter, grouped by location, +/- steppers for measured items, "On hand" pill for unmeasured staples | `GET /pantry`, `POST /pantry/adjust`, `POST /pantry/set` |
| `/recipes` | Recipe box | Photo grid, meal-type filter | `GET /recipes` |
| `/recipes/:slug` | Recipe | Photo hero, servings stepper that rescales, per-ingredient "in your pantry" mark, "fits your rules" badge, method | `GET /recipes/:slug/scaled`, `GET .../check`, `GET /pantry/availability` |
| `/recipes/:slug/cook` | Cook mode | One step per screen, timer for steps with a duration, all-ingredients drawer, wake lock, finish completes the cook (see below) | `POST /cook-events/:id/complete`, `POST /cook-events` |
| `/settings` | Settings | Theme, household name, default / dinner / lunch-batch servings | `GET /household`, `PATCH /household` |

Settings (v1): light/dark/system theme toggle, household name, and all three servings settings
(`defaultServings`, `dinnerServings`, `lunchBatchServings`). No unit-system toggle: the server stores
`unitSystem` but nothing converts yet, so the toggle would do nothing. Not in the mockup; designed in
the Glaze style.

### Finishing a cook (v1)

- Cook mode opened from a planned meal (`?cookEvent=<id>`) completes that cook event.
- Cook mode opened from the recipe box: if the same recipe has an open planned cook today, finishing
  asks "Cooking tonight's planned meal?" and completes that one. Otherwise finishing creates and
  completes an ad-hoc cook (no plan) at the servings shown on the recipe screen. Nothing is written
  until Finish, so abandoning cook mode leaves no trace.

Later: fuller plan editing (drag leftovers between days, change servings per slot), recipe status and
rating, dietary rules screen, ingredient merge, mascot.

### Meal swapping (v1)

The agent plans the week, so changing one night by hand has to be easy.

- Tap a slot (or its "Swap" action) to open a picker sheet. Empty slots use the same sheet ("Plan
  something").
- The picker lists recipes filtered to the slot's meal type, with search. Each row shows photo,
  time, a "fits your rules" mark (or the rule it hits), and how much of it the pantry already
  covers, so she can pick something that needs less shopping.
- Slots fed by one cook event (cook once, leftovers the next day) ask the scope: "Just this meal"
  or "This and its leftovers". Swapping the cook night with scope "this and leftovers" replaces the
  recipe on the cook event and every slot it feeds; "just this meal" turns that slot into its own
  cook.
- After a swap the shopping list shows a banner ("Your plan changed, update the list") that
  regenerates the list. Manual items are kept, and anything already checked off stays checked.
- Swapped-in meals are visually the same as agent-planned ones. No "agent vs human" badge in v1.

## Design language

The rules, with Glaze's specifics below:

- Phone first, thumb reachable, 44px+ targets, text readable at arm's length in a kitchen.
- Recipes are photo-first (`imageUrl`); everything else (pantry, shopping) is emoji plus type.
- No ALL CAPS labels, no arrows on buttons, sentence case everywhere, plain verbs.
- One memorable idea per direction, everything else quiet.

- Mood: cheerful, tactile, glazed ceramics. Cozy and cute, made for the household's primary cook.
- Palette: butter, pistachio, bubblegum and blueberry (one per tab), tomato for actions, cocoa ink.
- Type: Bricolage Grotesque only, heavy weights for titles.
- Memorable bit: each tab owns a color; die-cut emoji stickers; chunky, squishy buttons and checkboxes.
- Shape: big radii, soft colored blocks, press-down buttons, dashed dividers.
- Cook mode: butter-yellow screen with sticker ingredient chips (dark cocoa in dark mode).

**Decision:** Glaze.

Dark mode: follows the system setting, with a manual toggle in Settings (the mockup has a
temporary toggle top-right). Dark keeps the colored tabs and stickers on deep cocoa
(`#1E120D` background, `#2E1C14` cards, `#FFEBD6` ink) with slightly deepened accents. Cook mode is
butter yellow in light mode and dark cocoa in dark mode, since a bright screen is harsh in a dim kitchen.

Implementation: the design is expressed as tokens (color, type scale, radius, shadow, motion) with a
light set and a dark set, so themes stay additive. Respect
`prefers-reduced-motion`, keep visible focus rings, and keep contrast at WCAG AA in every theme.

## Gaps this design found in the backend

Status for the MVP:

1. **Network-trust auth** (see above). In the MVP.
2. **Step to ingredient links.** Deferred. Cook mode hides "you need" per step (word matching is wrong
   for things like "beef" vs "beef broth") and shows the full ingredient list in a drawer. Later plan:
   optional `recipe_step_ingredient` join table, per-step refs in recipe create/update and MCP, a
   server-side whole-word suggester, hand-checked backfill of the seed recipes.
3. **Recipe images.** Deferred. Seed images stay hotlinks; caching under `/media` is a later ticket.
4. **Shopping "done" flow.** The existing API covers it: `check` records actual quantities and
   `complete` writes purchases for checked items. The UI adds the review sheet with editable
   quantities.
5. **Today summary.** Composed client-side for now.
6. **Meal swap endpoint.** In the MVP: `POST /plans/:id/swap` (slot id, recipe, scope
   `this | with_leftovers`) in one transaction, plus a matching MCP tool. Shopping lists expose a
   `stale` flag (set when the plan changes after the list was generated) for the regenerate banner.
7. **Ad-hoc cooks.** In the MVP: `POST /cook-events` creates a cook outside any plan (the schema
   already allows a null plan).
8. **Expiry and "use soon".** Data exists (`expiry`, `shelfLifeDays`); a "use soon" strip is the
   obvious first feature after v1.

## Milestones

1. **Foundation:** `web/` package, Vite + TanStack, generated API client, tokens + chosen theme,
   app shell with nav, Docker/static serving, network-trust auth.
2. **Shop and pantry:** the two most-used screens, with optimistic updates. Includes the Done
   shopping review sheet.
3. **Recipes:** box, detail with scaling and availability, rules badge.
4. **Cook mode:** step view, timers, wake lock, finish flow.
5. **Week:** current plan view, tonight card, prep nudges, meal swap sheet (needs the swap endpoint).
6. **Polish:** empty and error states, loading skeletons, tablet and desktop layouts, accessibility
   pass, Playwright smoke tests, README screenshots.

## Decisions made

- Direction: Glaze. Dark mode: system plus manual toggle.
- Auth: network access is auth (`PANTRYPAL_TRUST_NETWORK=1`), reached via Tailscale Serve.
- Step-ingredient links: deferred; cook mode hides "you need".
- Done shopping: quick review sheet with editable quantities.
- Finishing a cook: one tap, assumes the servings shown; ad-hoc cooks when not planned.
- Mascot: deferred (jar emoji wordmark for now).
- Settings screen: theme, household name, three servings settings. No unit toggle.
- Meal swapping: in v1, via a picker sheet with leftover scope (see above).
- Shop shows the current week's list, with a picker for other open lists.
- No offline support; everything assumes a network connection.

## Open questions

None blocking.
