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

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 kira

# The Nitro node-server output is self-contained (server + bundled deps + static
# shell/assets under .output/public).
COPY --from=builder --chown=kira:nodejs /repo/apps/cloud/.output ./.output

USER kira

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", ".output/server/index.mjs"]
