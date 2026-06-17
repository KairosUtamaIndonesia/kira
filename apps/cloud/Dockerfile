FROM oven/bun:1.3.12-alpine AS deps
WORKDIR /repo

COPY package.json bun.lock turbo.json ./
COPY patches patches
COPY apps/cloud/package.json apps/cloud/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json

RUN bun install --filter=@kira/cloud --frozen-lockfile

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

CMD ["node", ".output/server/index.mjs"]
