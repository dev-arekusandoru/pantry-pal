# Backlog (post-v1)

Priority: **P0** needed for launch, **P1** next, **P2** later. Launch work lives in the two milestones under Launch readiness; do them in order.

## Platform
### Accounts
- [ ] P2 Share one household between several logins (1 account = 1 household today)
- [ ] P2 OAuth 2.1 for remote MCP clients

### Data and hosting
- [ ] P1 Per-tenant backup and restore
- [ ] P2 Postgres support (all tenants share one SQLite file; one busy tenant slows the rest)
- [ ] P2 `recipe_step_ingredient` join table, per-step refs in recipe create/update and MCP
- [ ] P2 Server-side whole-word step-to-ingredient suggester
- [ ] P2 Hand-checked backfill of seed recipes for the join table

### Tooling
- [ ] P1 CI for typecheck, tests, docker build (only the docs workflow exists)
- [ ] P1 Linter and formatter config
- [ ] P2 Playwright smoke flows: shop check-off, pantry adjust, cook mode

## Features
### Recipes
- [ ] P1 Cache recipe images under `/media` instead of hotlinking seed URLs
- [ ] P2 Step to ingredient links in cook mode (needs the join table)
- [ ] P2 Sticker book: check recipe details on tap
- [ ] P2 Sticker book: per-recipe collection (cooked recipes as stickers)

### Dietary rules
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

### Milestone 1: share the landing page and build the waitlist
1. [x] Housekeeping: email verification and password reset are built and sandbox tested (removed from Accounts)
2. [x] Check trademark collisions for "Rakumi": low risk. Only US "RAKUMI" mark is jewelry (class 14); a Japan-only restaurant-ordering app "Rakumi (ラクミー)" exists. Not checked (JS/captcha): USPTO tmsearch, WIPO, EUIPO, TMview
3. [x] Cloudflare Email Routing: `support@rakumi.app` and `hello@rakumi.app` forward to Alex (the Contact, Privacy, and Terms pages use `support@`)
4. [x] Privacy policy page (`landing/src/pages/privacy.astro`)
5. [x] Contact page; `privacy`, `terms`, `contact` URLs set in `landing/src/config.ts`
   - [ ] Have a lawyer review the Privacy Policy and Terms
   - [ ] Choose the analytics tool (app and landing site), then name it and any cookie it sets in the Privacy Policy
6. [x] Logo: Raku the jar (`docs/images/logo.svg`), used for the README, docs site, and both favicons
7. [x] Demo data: `seed/example.json` from a scrubbed copy of the prod household; free-license photos (`seed/PHOTO-CREDITS.md`). Plan week is fixed at 2026-11-16 to 11-22
8. [x] Hero shots from the demo data (light theme, mid-week): landing `week`, `shop`, `cook`, `pantry`; docs `week`, `shop`, `pantry`, `cook`, `recipes`
9. [x] Card at trial start: keep it (built and tested; Polar blocks repeat cards). Revisit if signups are low
10. [x] FAQ reviewed: friendlier answers, card framed as one trial per person, MCP question, "Who makes this?" removed
11. [x] FAQ layout: two columns on wide screens, one column under 860px
12. [ ] Review and tweak the landing page copy by hand (claims must match the app)
13. [ ] Deploy the landing site; start sharing `rakumi.app`

### Milestone 2: open to paying users
1. [ ] Verify the Docker image build (never run: build host had no Docker socket access)
2. [ ] Multi-tenant database decision (see Postgres under Platform)
3. [ ] Scheduled backups for the hosted service, with a restore test (landing page promises "backups handled")
4. [ ] Import recipe from a link (schema.org/Recipe). LAUNCH GATE: the landing page shows it as available. The web app has none today (editor, API, MCP only)
5. [ ] Dietary rules screen (the landing page mentions rules). The ingredient page lists rules read-only; add and edit work only through the API and MCP
6. [ ] Manual data-copy runbook for members (no export feature needed)
7. [ ] Rename internals (user-facing text is done). Do it before paying users: the cookie rename signs everyone out
   - [ ] Migration plan for the running instance (cookie and localStorage renames sign people out)
   - [ ] Packages (`pantrypal`, `@pantrypal/*`), CLI, MCP server name
   - [ ] `PANTRYPAL_*` env vars, `data/pantrypal.db`
   - [ ] Docker service, image, network names; `scripts/deploy.sh`
   - [ ] Session cookie and localStorage keys (`pantrypal.*`, `pantry-pal:*`)
   - [ ] `Pal` component and file names
   - [ ] Worker name `pantrypal-waitlist` (URL changes; update `waitlistEndpoint`)
   - [ ] GitHub repo and Pages URL (`pantry-pal`); update links in `landing/src/config.ts`
8. [ ] Move the landing page to `get.rakumi.app` or `rakumi.app/get` (decide which; decide the docs subdomain too). Signed-out visitors to `rakumi.app` redirect there; the landing page shows the sign-in and sign-up buttons. Links shared in Milestone 1 keep working through the redirect
9. [x] Terms page with 30-day deletion after a lock (`landing/src/pages/terms.astro`); sign-up form links it on hosted
10. [x] Refund and cancellation wording (section 6 of the Terms)
11. [ ] Check that Polar's legal requirements are met
12. [ ] Support channel
13. [ ] Go-live setup: Polar production org, products, token (scopes: `checkouts:write`, `customer_sessions:write`, `subscriptions:read`, `products:read`, `customers:write`), webhook, trial-abuse setting; `app.rakumi.app` DNS and tunnel; production env; `billing exempt` for own household; Resend transactional on Pro for launch week (free plan caps app emails at 100/day)
14. [ ] Launch day: set `signupUrl` in `landing/src/config.ts` (switches the call to action to the 14-day trial), deploy the landing site, send the waitlist invite broadcast (steps in `docs/host/waitlist.md`). Signup opens to everyone; no invite codes

### Later (not a launch blocker)
- [ ] Decide what hosted/Polar setup to document in the open-source docs (operator guide not written on purpose)

### Done
- [x] Name Rakumi, `rakumi.app` bought, user-facing text renamed
- [x] Waitlist Worker written and deployed; `waitlistEndpoint` set; Resend sending domain verified; welcome email with Raku image
- [x] Invite plan: one Resend broadcast to the whole waitlist when the product is ready
- [x] Polar billing: $3.99/mo or $39/yr, 14-day trial with card, no free tier (sandbox tested)
  - Won't do: the paywall cannot show "trial unavailable" before checkout. Polar decides trial eligibility at checkout (card check). The paywall and FAQ say "one free trial per person" instead.
- [x] Lock on lapse or failed renewal
- [x] Delete data 30 days after the lock (daily job, warning emails)
- [x] Delete the Polar customer when a household is deleted (anonymized; retried daily on failure)
- [x] 7-day refund on first charge: decided. First charge only, asked within 7 days of it. Manual: user emails, Alex refunds the order and cancels the subscription in the Polar dashboard; the household locks (normal 30-day deletion). No code. Goes in the refund policy page.
- [x] Email sending: verification, password reset, deletion warnings
- [x] Manual test pass of the hosted flows (sandbox): signup, verify, checkout, plan, cancel, lock, password reset, Polar customer delete
- Dropped: invite-code signup. The waitlist only gets an invite email; signup opens to everyone on launch day
