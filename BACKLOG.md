# Backlog (post-v1)

## Frontend
- Fuller plan editing beyond the swap sheet: drag leftovers between days, per-slot servings
- Step ↔ ingredient links in cook mode (needs the backend join table below)
- Dietary rules screen. The landing page mentions dietary rules; today they work through the API and MCP only (no screen, no warnings on recipe, week, or shop)
- Ingredient merge UI
- Cache recipe images under `/media` instead of hotlinking seed URLs
- "Use soon" strip from `expiry` / `shelfLifeDays`
- Pantry expiry: show "use soon" on the week and shopping screens too (today only the Pantry tab warns)
- Mascot / illustrated character
- Playwright smoke flows (shop check-off, pantry adjust, cook mode)

## Platform
- OAuth 2.1 for remote MCP clients
- Accounts: email verification on signup (open signup accepts any address today)
- Accounts: password reset over email (needs SMTP; today the admin resets with the CLI)
- Accounts: share one household between several logins (today 1 account = 1 household)
- Database for many tenants: Postgres support (all tenants share one SQLite file today; one busy tenant slows the rest, no per-tenant backup/restore)
- Backups: scheduled backups for the hosted service (the landing page promises "backups handled"; today they are manual commands). Data export (JSON dump, markdown week export) only if it is needed
- Optional `recipe_step_ingredient` join table, per-step refs in recipe create/update and MCP, a
  server-side whole-word suggester, hand-checked backfill of the seed recipes

## Features
- Recipe import from a link (schema.org/Recipe scraping). LAUNCH GATE: the landing page comparison shows "Save recipes from a link" as available, so ship it before the page goes live. The web app has no import today (manual editor, API and MCP only)
- Barcode scanning for the pantry (priority)
- Voice control in cook mode: read steps aloud, voice commands for next step and timers (priority)
- Calendar feed (iCal) for the meal plan
- Monthly plan view (week arrows only today)
- Daily nutrition totals on the week plan (nutrition shows per recipe only today)
- Translations / localization (English only today)
- Metric/imperial: add a household unit-system control in Settings (the setting exists, no screen)
- Native or installable mobile app (future; today a responsive mobile website with no PWA)
- Receipt/photo → pantry bulk import
- Analytics: what we actually eat, waste, cost per meal
- Price tracking per ingredient/store
- Purchase-friendly units on shopping lists: tiny converted amounts show as "0.02 cup" sugar or "0.13 cup" flour; show them in the recipe unit or round to package sizes
- Weekly missions are the same three rules every week (home dinners, try something new, finish prep, plus sweep). Vary them: rotating or seasonal missions, pantry-driven ones such as "use up the celery", co-op missions
- Co-op cooking celebrations: a joint "cooked together" moment and shared stamp when two people cook the same meal in multiplayer cook mode
- Pantry sweep: skip a duplicate shopping list entry when the item is already on the list; offer Undo from the summary; test swiping on a real touch device; make the snooze lengths (3 and 7 days) a setting
- Gamification state (treat used, sweep count, sweep snooze) is stored per browser; move it to the household so it follows you across devices
- Sticker book: check the recipe details on tap, and add a per-recipe collection (cooked recipes as stickers)
- Design: redo dark mode in the Kitchen Diary look (the dark palette is the old one and is opt-in); update docs screenshots; check Cook mode, Settings, 320px width and 200% zoom after the restyle
- Week page: wall tablet layout. The page now allows 1560px, but the week timeline fills only the left part of a 1920px screen; use the free width, for example two days side by side or a week grid beside it
- Week page: let people edit the meal time windows (breakfast until 10:30, lunch until 15:00) in Settings; keep a week grid view as an option beside the timeline
- Week page: check other weeks (browsing next and last week), 200% zoom and measured text contrast over recipe photos
- Living Pal (cozy): Pal reacts to pantry health and cooking, and unlocks outfits. Pal gets sleepy, never sad

## Tooling
- CI (typecheck + tests + docker build), linter/formatter config
- Verify the Docker image build (not yet run: the build host had no Docker socket access)

## Launch readiness
- Legal minimum for taking payments: privacy policy, terms (including the 30-day deletion after a lock), refund/cancellation wording, and a product contact address (not a personal one). Polar also requires these
- Brand: pick and buy a domain (landing page at the root, app on a subdomain, docs on a subdomain or `/docs`); check trademark collisions for "PantryPal" (the name is common); replace the placeholder logo
- Marketing screenshots: seed realistic demo data (recipes with photos) and shoot clean hero shots of Week, Pantry, Recipes, Cook mode, Shop; the current docs screenshots are not marketing quality
- Pre-launch strategy: the waitlist service exists (`waitlist/`, docs/host/waitlist.md). Still to do: deploy it, pick a sending domain and SMTP provider for the welcome email, decide how and when to invite people (the `invite` command only marks addresses; sending invitations is not built), then switch the call to action to the 14-day trial when signup and billing work
- Hosted-version requirements: invite-code signup, Polar billing ($3.99/mo or $39/yr, 14-day Polar trial with card, no free tier), lock on lapse or failed renewal, delete data 30 days after the lock, 7-day refund on the first charge, email sending, scheduled backups, and a support channel. Plan: `scratch/hosting-plan.md`. Overlaps with the Platform items above (email verification, password reset, multi-tenant database). Several people already sign in on one account from different devices; separate logins per person stay in Platform
- Landing page FAQ promises: a member can ask for a copy of their data (a manual export is fine, there is no export feature), and all data is deleted 30 days after the plan ends. The comparison grid and FAQ show "Save recipes from a link" as available, so recipe import must ship before launch
- Landing page links: write the privacy, terms, and contact pages, then set their URLs in `landing/src/config.ts` (the footer hides each link until its URL is set). Set `site` in `landing/astro.config.mjs` once the domain is chosen (enables canonical URLs and a sitemap). Set `waitlistEndpoint` in the same config file once the waitlist service is deployed
