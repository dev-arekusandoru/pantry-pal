# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage: full dependency tree (dev deps included), TypeScript compile for
# the server and the Vite build for the web app (web/dist).
# better-sqlite3 is a native module; pnpm runs its install script (prebuild or
# node-gyp fallback), so the toolchain has to be present here.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global pnpm@12 \
  && pnpm --version

WORKDIR /app

# The workspace file carries `allowBuilds` for better-sqlite3/esbuild; without
# it pnpm refuses to run those install scripts.
# Every workspace package manifest is needed for a frozen install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/package.json
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY drizzle ./drizzle
COPY web ./web
# `pnpm build` = server (dist/) + web (web/dist).
RUN pnpm build

# Drop dev dependencies (typescript, drizzle-kit, tsx, vitest, and the whole web
# toolchain: the web app is fully bundled into web/dist).
RUN pnpm prune --prod

# ---------------------------------------------------------------------------
# Runtime stage: compiled output + production node_modules only.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PANTRYPAL_DB_PATH=/data/pantrypal.db \
    PORT=8787 \
    HOST=0.0.0.0

WORKDIR /app

# package.json is required at runtime: `packageRoot()` walks up from dist/ to
# find it (version reporting) and migrations live next to it in `drizzle/`.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Static web app, served by the Hono server at `/` (path: <package root>/web/dist).
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/drizzle ./drizzle
# Curated seed file, so `node dist/cli.js seed seed/chef-2026-11.json` works in
# the container without extra mounts.
COPY seed ./seed

RUN mkdir -p /data && chown -R node:node /app /data

USER node

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
