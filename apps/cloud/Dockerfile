FROM oven/bun:1.3.12-alpine AS deps
WORKDIR /repo

COPY package.json bun.lock turbo.json ./
COPY patches patches
COPY apps/cloud/package.json apps/cloud/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json

RUN mkdir -p apps/desktop/agent-pi \
    && echo '{"name":"agent-pi","private":true,"version":"0.0.0"}' > apps/desktop/agent-pi/package.json \
    && bun install --filter=@kira/cloud \
    && bun add --dev turbo@2.6.3

FROM oven/bun:1.3.12-alpine AS builder
WORKDIR /repo

ENV SKIP_ENV_VALIDATION=1

# VITE_* env vars are baked into the client bundle at build time. Pass the
# public-facing URL so the client-side Better Auth instance knows where to send
# requests.  Defaults to the local dev URL for local builds.
ARG VITE_BETTER_AUTH_URL=https://cloud.kira.localhost
ENV VITE_BETTER_AUTH_URL=$VITE_BETTER_AUTH_URL

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps ./apps
COPY --from=deps /repo/packages ./packages
COPY . .

RUN bun run turbo build --filter=@kira/cloud

# Build standalone migration script bundle (self-contained, includes pg + drizzle-orm).
RUN bun build apps/cloud/scripts/db-migrate.ts --target node --outfile apps/cloud/.output/db-migrate.mjs


# ---- Runner stage ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Install curl for health checks. node:22-alpine ships BusyBox wget which does
# not support --spider and can fail on IPv6 localhost resolution.  curl is more
# reliable for container health checks.
RUN apk add --no-cache curl \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 kira

# The Nitro node-server output is self-contained (server + bundled deps + static
# shell/assets under .output/public).
COPY --from=builder --chown=kira:nodejs /repo/apps/cloud/.output ./.output

# Drizzle migration SQL files inside .output so the migration bundle at
# ./.output/db-migrate.mjs can find them via import.meta.dirname.
COPY --from=builder --chown=kira:nodejs /repo/apps/cloud/drizzle ./.output/drizzle

USER kira

EXPOSE 3000

# Use 127.0.0.1 (not localhost) to avoid IPv6 resolution mismatches with the
# server binding on 0.0.0.0.
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/api/health || exit 1
# Run migrations on startup, then start the Nitro server. The migration bundle
# is self-contained (pg + drizzle-orm inlined) and only reads DATABASE_URL from
# the environment — no drizzle-kit or additional tooling needed.
CMD node ./.output/db-migrate.mjs && node .output/server/index.mjs

