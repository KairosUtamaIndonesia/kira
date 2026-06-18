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

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps ./apps
COPY --from=deps /repo/packages ./packages
COPY . .

RUN bun run turbo build --filter=@kira/cloud


# ---- Runner stage ----
# Use the same Alpine base as deps/builder for consistency.
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install curl for health checks. node:22-alpine ships BusyBox wget which does
# not support --spider and can fail on IPv6 localhost resolution.  curl is more
# reliable for container health checks.
RUN apk add --no-cache curl \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 kira

# The Nitro node-server output is self-contained (server + bundled deps + static
# shell/assets under .output/public).
COPY --from=builder --chown=kira:nodejs /repo/apps/cloud/.output ./.output

USER kira

EXPOSE 3000

# Use 127.0.0.1 (not localhost) to avoid IPv6 resolution mismatches with the
# server binding on 0.0.0.0.
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/api/health || exit 1

CMD ["node", ".output/server/index.mjs"]

