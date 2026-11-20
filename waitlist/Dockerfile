# syntax=docker/dockerfile:1
# Build from the repository root: docker compose -f docker-compose.waitlist.yml up -d --build

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global pnpm@12
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY waitlist/package.json ./waitlist/package.json
RUN pnpm install --frozen-lockfile --filter @pantrypal/waitlist...
COPY tsconfig.json ./
COPY waitlist ./waitlist
RUN pnpm --filter @pantrypal/waitlist build \
  && pnpm --filter @pantrypal/waitlist --prod deploy /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    WAITLIST_DB_PATH=/data/waitlist.db \
    WAITLIST_CONFIG=/config/waitlist.config.json \
    PORT=8790 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /app/waitlist/dist ./dist
RUN mkdir -p /data && chown -R node:node /app /data
USER node
VOLUME ["/data"]
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8790)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
