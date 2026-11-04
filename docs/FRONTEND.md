# PantryPal web frontend: plan

Status: direction chosen (**Glaze**, with dark mode). The Glaze design is implemented in
`web/src/styles/tokens.css` and the screens under `web/src/screens/`.

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
| Styling | Plain CSS with design tokens (CSS variables), CSS modules per component | Token-driven design, so the theme is a token file. Avoids a utility framework fighting a distinctive design |
| Icons | [Phosphor](https://phosphoricons.com) (bold weight) for UI chrome, [OpenMoji](https://openmoji.org) color SVGs for food and stickers | One consistent, self-hosted set each; only the OpenMoji files actually used are bundled (CC BY-SA 4.0, attribution in Settings and README) |
| Tests | Vitest + Testing Library, a few Playwright smoke flows | Shop check-off, pantry adjust, cook mode |

Layout in the repo: `web/` as a pnpm workspace package. `pnpm build` produces `web/dist`, which the
server serves at `/` with an SPA fallback. The Docker image stays a single container. In dev, Vite
proxies `/api` to the Hono server.

Development:

- `PANTRYPAL_TRUST_NETWORK=1 pnpm dev` (API) plus `pnpm web:dev` (Vite on :5173, proxies `/api` and
  `/health` to `127.0.0.1:4787`, or `PANTRYPAL_API_URL`).
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
| `/` | Week | Prev/next arrows in the header move week by week; the week lives in `?week=YYYY-MM-DD` (Monday-based, validated) so Back and deep links work, with a "This week" button while browsing. Current week: "Dinner tonight" card, next prep nudge, day-by-day slots with leftover markers, empty slots offer "plan something", every slot can be swapped (see below). Empty week: this week keeps the friendly start-an-empty-week state, a future week offers "Plan this week" (coming soon toast), a past week just says nothing was planned | `GET /plans/:weekStart` (id or weekStart), `GET /prep-tasks`, `POST /plans/:id/swap` |
| `/shop` | Shopping | The current week's list by default, with a picker for other open lists. Aisle groups, big tap rows, progress, add by hand, "Clear list" (confirmed in a sheet) removes every item, "Done shopping" turns checked items into pantry stock | `GET /shopping-lists`, `POST .../check`, `POST .../items`, `DELETE .../items`, `POST .../complete` |
| `/pantry` | Pantry | Search, location filter, grouped by location, +/- steppers for measured items, "On hand" pill for unmeasured staples, tap an item to set an exact amount or remove it (confirmed, with Undo) | `GET /pantry`, `POST /pantry/adjust`, `POST /pantry/set`, `DELETE /pantry/:id` |
| `/recipes` | Recipe box | Photo grid, status views ("Rotation + want to try" by default, "Never" with a way back), meal-type filter, search. New-to-try cards carry a tag | `GET /recipes`, `POST /recipes/:slug/status` |
| `/recipes/:slug` | Recipe | Photo hero, servings stepper that rescales, per-ingredient "in your pantry" mark, source link when the recipe was imported, status control (👍 rotation / want to try / 👎 never), "resume at step N" when a cook is in progress, method | `GET /recipes/:slug/scaled`, `GET /pantry/availability`, `POST /recipes/:slug/status` |
| `/recipes/:slug/cook` | Cook mode | One step per screen, timer for steps with a duration, all-ingredients drawer, wake lock, progress saved locally for resume, finish completes the cook (see below) | `POST /cook-events/:id/complete`, `POST /cook-events`, `POST /cook-events/:id/undo` |
| `/settings` | Settings | Theme, household name, default / dinner / lunch-batch servings | `GET /household`, `PATCH /household` |

Settings (v1): light/dark/system theme toggle, household name, and all three servings settings
(`defaultServings`, `dinnerServings`, `lunchBatchServings`). No unit-system toggle: the server stores
`unitSystem` but nothing converts yet, so the toggle would do nothing. Designed in the Glaze style.

### Finishing a cook (v1)

- Cook mode opened from a planned meal (`?cookEvent=<id>`) completes that cook event.
- Cook mode opened from the recipe box: if the same recipe has an open planned cook today, finishing
  asks "Cooking tonight's planned meal?" and completes that one. Otherwise finishing creates and
  completes an ad-hoc cook (no plan) at the servings shown on the recipe screen. Nothing is written
  to the server until Finish, so abandoning cook mode leaves no pantry or plan trace (the step
  position stays on the device only).
- A `?cookEvent=` link can outlive its cook (the week was replanned or the meal swapped after the
  link was opened). If completing that event answers 404, finishing falls back to today's planned
  cook for the recipe, or to an ad-hoc cook, instead of failing.
- Finishing shows an Undo action in the toast (and on the done screen): it restores the pantry stock
  the cook took out and returns a planned cook to `planned`, or deletes an ad-hoc cook. Done meals
  on the week screen carry the same Undo.
- Progress is saved per recipe in `localStorage` (step, servings and planned cook). Re-entering cook
  mode offers "Resume at step N" or "Start over"; the recipe page links straight back to the saved
  step. Finishing or undoing clears it. Timers are not persisted.
- Leaving cook mode (X or finishing) pops/replaces the cook route so the recipe page's back button
  returns to the page the user came from, not back into cook mode.
- When the cooked recipe is still `want_to_try`, the done screen asks "How was it?" with 👍 (moves it
  to rotation), 👎 (moves it to never) and "Not now" (status unchanged).

### Recipe status (v1)

- The recipe box shows one status view at a time: **Rotation + want to try** (default; want-to-try
  cards carry a "New to try" tag) or **Never**. The meal-type chips combine with it (AND), and the
  search + filters live in the URL (`?view=never&meal=dinner&q=`).
- Never recipes are absent from the default view and from the week's swap picker. The never list
  offers "Move to rotation" on each card.
- `archived` has no UI: archived recipes are hidden from every list and get no status control. The
  status control on the recipe page (👍 Rotation / Want to try / 👎 Never) both reflects and sets the
  status, and cook mode's post-cook prompt writes the same statuses. Every change goes through
  `POST /recipes/:slug/status` (which appends a status event) and invalidates the recipe queries, so
  the detail and every list refresh.

Later: fuller plan editing (drag leftovers between days, change servings per slot), dietary rules
screen, ingredient merge, mascot.

### Meal swapping (v1)

The agent plans the week, so changing one night by hand has to be easy.

- Tap a slot (or its "Swap" action) to open a picker sheet. Empty slots use the same sheet ("Plan
  something").
- The picker lists recipes filtered to the slot's meal type, with search. Each row shows photo,
  time, and how much of it the pantry already covers, so she can pick something that needs less
  shopping.
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
- Recipes are photo-first (`imageUrl`); everything else (pantry, shopping) is an OpenMoji icon plus type.
- No ALL CAPS labels, no arrows on buttons, sentence case everywhere, plain verbs.
- Primary add/create actions are a tomato FAB, never a header button: it floats above the bottom
  nav on phones and at the bottom-right of the content column on tablet and desktop (see `ui/Fab`).
- One memorable idea per direction, everything else quiet.

- Mood: cheerful, tactile, glazed ceramics. Cozy and cute, made for the household's primary cook.
- Palette: butter, pistachio, bubblegum and blueberry (one per tab), tomato for actions, cocoa ink.
- Type: Bricolage Grotesque only, heavy weights for titles.
- Memorable bit: each tab owns a color; die-cut OpenMoji stickers; chunky, squishy buttons and checkboxes.
- Icons: Phosphor (bold) for UI affordances, OpenMoji color SVGs for anything edible or celebratory.
  `ui/Emoji` renders an `<img>` with an inline size (no layout shift); `ingredientEmoji(name)` maps
  an ingredient to an OpenMoji hexcode. New food icons are imported from the `openmoji` package in
  `ui/emoji.ts`; never bundle the full set.
- Shape: big radii, soft colored blocks, press-down buttons, dashed dividers.
- Cook mode: butter-yellow screen with sticker ingredient chips (dark cocoa in dark mode).

**Decision:** Glaze.

Dark mode: follows the system setting, with a manual toggle in Settings. Dark keeps the colored tabs
and stickers on deep cocoa (`#1E120D` background, `#2E1C14` cards, `#FFEBD6` ink) with slightly
deepened accents. Cook mode is butter yellow in light mode and dark cocoa in dark mode, since a
bright screen is harsh in a dim kitchen.

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
3. **Recipes:** box, detail with scaling, availability and source link.
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
- Recipe status: default box view is rotation + want to try, "Never" is a separate list, and status
  changes write through `POST /recipes/:slug/status` from the recipe page and the post-cook prompt.
- No offline support; everything assumes a network connection.

## Open questions

None blocking.
