FROM oven/bun:1.3.12-alpine AS deps
WORKDIR /repo

COPY package.json bun.lock turbo.json ./
COPY patches patches
COPY apps/admin/package.json apps/admin/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/desktop/agent-runtime/package.json apps/desktop/agent-runtime/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json

RUN bun install --frozen-lockfile

FROM oven/bun:1.3.12-alpine AS builder
WORKDIR /repo

ENV NEXT_TELEMETRY_DISABLED=1
ENV SKIP_ENV_VALIDATION=1

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps ./apps
COPY --from=deps /repo/packages ./packages
COPY . .

RUN bun run turbo build --filter=@kira/admin

FROM node:22-alpine AS runner
WORKDIR /app

ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /repo/apps/admin/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/admin/public ./apps/admin/public

USER nextjs
WORKDIR /app/apps/admin

EXPOSE 3000

CMD ["node", "server.js"]
