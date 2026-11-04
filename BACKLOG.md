# Backlog (post-v1)

## Frontend
- Web app on the REST API: pantry table + stock edits
- Week plan view: drag leftovers between days, per-slot servings (basic meal swap is in v1, see docs/FRONTEND.md)
- Recipe browser + cooking mode (step-by-step instructions, scaled ingredients, wake lock)
- Shopping list mobile view (check off in store)

## Platform
- Real web auth (login + session cookie, or OAuth); v1 frontend relies on Tailscale network access
- OAuth 2.1 for remote MCP clients
- Multiple households per instance (users, membership, token → household scoping)
- Postgres support
- Backups/export (JSON dump, markdown week export)

## Features
- Mascot / illustrated character for the web app
- Recipe URL import (schema.org/Recipe scraping)
- Receipt/photo → pantry bulk import
- Expiry dates and use-soon alerts
- Analytics: what we actually eat, waste, cost per meal
- Price tracking per ingredient/store
- Purchase-friendly units on shopping lists: tiny converted amounts show as "0.02 cup" sugar or "0.13 cup" flour; show them in the recipe unit or round to package sizes
- Smarter staple handling: spices/oils with unknown stock currently land in the "check pantry" bucket every week

## Tooling
- CI (typecheck + tests + docker build), linter/formatter config
- Verify the Docker image build (not yet run: the build host had no Docker socket access)
