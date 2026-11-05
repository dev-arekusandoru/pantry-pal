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
- Real web auth (login + session cookie, or OAuth); v1 frontend relies on Tailscale network access
- OAuth 2.1 for remote MCP clients
- Multiple households per instance (users, membership, token → household scoping)
- Postgres support
- Backups/export (JSON dump, markdown week export)
- Optional `recipe_step_ingredient` join table, per-step refs in recipe create/update and MCP, a
  server-side whole-word suggester, hand-checked backfill of the seed recipes

## Features
- Recipe URL import (schema.org/Recipe scraping)
- Receipt/photo → pantry bulk import
- Analytics: what we actually eat, waste, cost per meal
- Price tracking per ingredient/store
- Purchase-friendly units on shopping lists: tiny converted amounts show as "0.02 cup" sugar or "0.13 cup" flour; show them in the recipe unit or round to package sizes
- Smarter staple handling: spices/oils with unknown stock currently land in the "check pantry" bucket every week

## Tooling
- CI (typecheck + tests + docker build), linter/formatter config
- Verify the Docker image build (not yet run: the build host had no Docker socket access)
