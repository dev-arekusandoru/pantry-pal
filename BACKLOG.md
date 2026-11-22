# Backlog (post-v1)

Priority: **P0** needed for launch, **P1** next, **P2** later. Launch items live in Launch readiness below.

## Platform
### Accounts
- [ ] P0 Email verification on signup (open signup accepts any address)
- [ ] P0 Password reset over email (needs SMTP; admin resets with the CLI today)
- [ ] P2 Share one household between several logins (1 account = 1 household today)
- [ ] P2 OAuth 2.1 for remote MCP clients

### Data and hosting
- [ ] P0 Scheduled backups for the hosted service (landing page promises "backups handled")
- [ ] P1 Manual data-copy runbook (JSON dump or markdown week export only if needed)
- [ ] P1 Per-tenant backup and restore
- [ ] P2 Postgres support (all tenants share one SQLite file; one busy tenant slows the rest)
- [ ] P2 `recipe_step_ingredient` join table, per-step refs in recipe create/update and MCP
- [ ] P2 Server-side whole-word step-to-ingredient suggester
- [ ] P2 Hand-checked backfill of seed recipes for the join table

### Tooling
- [ ] P0 Verify the Docker image build (never run: build host had no Docker socket access)
- [ ] P1 CI for typecheck, tests, docker build (only the docs workflow exists)
- [ ] P1 Linter and formatter config
- [ ] P2 Playwright smoke flows: shop check-off, pantry adjust, cook mode

## Features
### Recipes
- [ ] P0 Import recipe from a link (schema.org/Recipe). LAUNCH GATE: landing page shows it as available. Web app has none today (editor, API, MCP only)
- [ ] P1 Cache recipe images under `/media` instead of hotlinking seed URLs
- [ ] P2 Step to ingredient links in cook mode (needs the join table)
- [ ] P2 Sticker book: check recipe details on tap
- [ ] P2 Sticker book: per-recipe collection (cooked recipes as stickers)

### Dietary rules
- [ ] P0 Dietary rules screen (landing page mentions rules). The ingredient page lists rules read-only; add and edit work only through API and MCP
- [ ] P1 Warnings on recipe, week, and shop screens

### Pantry
- [ ] P1 "Use soon" strip from `expiry` / `shelfLifeDays`
- [ ] P1 Show "use soon" on week and shopping screens (only the Pantry tab warns today)
- [ ] P1 Barcode scanning
- [ ] P2 Receipt/photo to pantry bulk import
- [ ] P2 Pantry sweep: skip entries already on the shopping list
- [ ] P2 Pantry sweep: Undo from the summary
- [ ] P2 Pantry sweep: test swiping on a real touch device
- [ ] P2 Pantry sweep: make snooze lengths (3 and 7 days) a setting

### Shopping
- [ ] P1 Purchase-friendly units ("0.02 cup" sugar): show recipe unit or round to package sizes
- [ ] P2 Price tracking per ingredient/store

### Cooking
- [ ] P1 Voice control in cook mode: read steps aloud
- [ ] P1 Voice commands for next step and timers

### Week plan
- [ ] P1 Check other weeks (next/last), 200% zoom, text contrast over recipe photos
- [ ] P1 Wall tablet layout: use free width on 1920px (two days side by side or week grid)
- [ ] P2 Editable meal time windows in Settings (breakfast until 10:30, lunch until 15:00)
- [ ] P2 Week grid view as an option beside the timeline
- [ ] P2 Fuller plan editing: drag leftovers between days
- [ ] P2 Fuller plan editing: per-slot servings
- [ ] P2 Monthly plan view
- [ ] P2 Daily nutrition totals on the week plan
- [ ] P2 Calendar feed (iCal)

### Settings
- [ ] P1 Household unit-system control (setting exists, no screen)
- [ ] P2 Translations / localization (English only)

### Design
- [ ] P1 Redo dark mode in the Kitchen Diary look (palette is old, opt-in)
- [ ] P1 Update docs screenshots
- [ ] P1 Check Cook mode, Settings, 320px width, 200% zoom after restyle
- [ ] P2 Mascot / illustrated character
- [ ] P2 Native or installable app (no PWA today)

### Gamification
- [ ] P1 Move treat used, sweep count, sweep snooze from per-browser to household
- [ ] P2 Vary weekly missions: rotating or seasonal
- [ ] P2 Pantry-driven missions ("use up the celery")
- [ ] P2 Co-op missions
- [ ] P2 Co-op cooked-together moment and shared stamp
- [ ] P2 Living Raku: reacts to pantry health and cooking (sleepy, never sad)
- [ ] P2 Raku outfits unlocks

### Insights
- [ ] P2 Insights: what we eat, waste, cost per meal

## Launch readiness

### Legal and contact
- [ ] Privacy policy page
- [ ] Terms page (include 30-day deletion after a lock)
- [ ] Refund and cancellation wording (7-day refund on first charge)
- [ ] Product contact address (not personal)
- [ ] Set `privacy`, `terms`, `contact` URLs in `landing/src/config.ts` (footer hides links until set)
- [ ] Check Polar's legal requirements are met

### Brand
- [x] Name Rakumi, `rakumi.app` bought, user-facing text renamed
- [ ] Check trademark collisions for "Rakumi"
- [ ] Replace placeholder logo
- [ ] Decide subdomains (app, docs)

### Marketing assets
- [ ] Seed realistic demo data (recipes with photos)
- [ ] Shoot hero shots: Week, Pantry, Recipes, Cook mode, Shop

### Waitlist and pre-launch
- [x] Worker written and deployed; `waitlistEndpoint` set
- [x] Resend sending domain verified
- [x] Welcome email sent from the Worker (HTML, with Raku image from `rakumi.app/raku-email.png`; deploy landing for the image to load)
- [x] Invite plan: when the product is ready, send one Resend broadcast to the whole waitlist (steps in `docs/host/waitlist.md`)

### Launch day (last, after legal, go-live, and the rest of this backlog)
- [ ] Set `signupUrl` in `landing/src/config.ts` (switches the call to action to the 14-day trial), then deploy the landing site
- [ ] Send the waitlist invite broadcast (steps in `docs/host/waitlist.md`)

### Hosted version (plan: `scratch/hosting-plan.md`)
- [ ] Invite-code signup
- [x] Polar billing: $3.99/mo or $39/yr, 14-day trial with card, no free tier (sandbox tested)
  - Won't do: the paywall cannot show "trial unavailable" before checkout. Polar decides trial eligibility at checkout (card check). The paywall and FAQ say "one free trial per person" instead.
- [x] Lock on lapse or failed renewal
- [x] Delete data 30 days after the lock (daily job, warning emails)
- [x] Delete the Polar customer when a household is deleted (anonymized; retried daily on failure)
- [x] 7-day refund on first charge: decided. First charge only, asked within 7 days of it. Manual: user emails, Alex refunds the order and cancels the subscription in the Polar dashboard; the household locks (normal 30-day deletion). No code. Goes in the refund policy page (Legal).
- [x] Email sending: verification, password reset, deletion warnings
- [x] Manual test pass of the hosted flows (sandbox): signup, verify, checkout, plan, cancel, lock, password reset, Polar customer delete
- [ ] Decide what hosted/Polar setup to document in the open-source docs (operator guide not written on purpose)
- [ ] Go-live setup (hold until ready): Polar production org, products, token (scopes: `checkouts:write`, `customer_sessions:write`, `subscriptions:read`, `products:read`, `customers:write`), webhook, trial-abuse setting; `app.rakumi.app` DNS and tunnel; production env; `billing exempt` for own household; Resend transactional on Pro for launch week (free plan caps app emails at 100/day)
- [ ] Scheduled backups
- [ ] Support channel
- [ ] Multi-tenant database decision (see Platform)

### Promises on the landing page
- [ ] Recipe import from a link (LAUNCH GATE, see Features)
- [ ] Manual data-copy process for members (no export feature needed)
- [ ] Data deleted 30 days after the plan ends (same as the hosted-version item)

### Rename internals (user-facing text is done)
- [ ] Write a migration plan for the running instance (cookie and localStorage renames sign people out)
- [ ] Packages (`pantrypal`, `@pantrypal/*`), CLI, MCP server name
- [ ] `PANTRYPAL_*` env vars, `data/pantrypal.db`
- [ ] Docker service, image, network names; `scripts/deploy.sh`
- [ ] Session cookie and localStorage keys (`pantrypal.*`, `pantry-pal:*`)
- [ ] `Pal` component and file names
- [ ] Worker name `pantrypal-waitlist` (URL changes; update `waitlistEndpoint`)
- [ ] GitHub repo and Pages URL (`pantry-pal`); update links in `landing/src/config.ts`
