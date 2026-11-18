# Backlog (post-v1)

## Frontend
- Fuller plan editing beyond the swap sheet: drag leftovers between days, per-slot servings
- Step ↔ ingredient links in cook mode (needs the backend join table below)
- Dietary rules screen
- Ingredient merge UI
- Cache recipe images under `/media` instead of hotlinking seed URLs
- "Use soon" strip from `expiry` / `shelfLifeDays`
- Mascot / illustrated character
- Playwright smoke flows (shop check-off, pantry adjust, cook mode)

## Platform
- OAuth 2.1 for remote MCP clients
- Accounts: email verification on signup (open signup accepts any address today)
- Accounts: password reset over email (needs SMTP; today the admin resets with the CLI)
- Accounts: share one household between several logins (today 1 account = 1 household)
- Database for many tenants: Postgres support (all tenants share one SQLite file today; one busy tenant slows the rest, no per-tenant backup/restore)
- Backups/export (JSON dump, markdown week export)
- Optional `recipe_step_ingredient` join table, per-step refs in recipe create/update and MCP, a
  server-side whole-word suggester, hand-checked backfill of the seed recipes

## Features
- Recipe URL import (schema.org/Recipe scraping)
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

## Tooling
- CI (typecheck + tests + docker build), linter/formatter config
- Verify the Docker image build (not yet run: the build host had no Docker socket access)
