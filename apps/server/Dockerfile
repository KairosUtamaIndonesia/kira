FROM oven/bun:1.4.2 AS dependencies

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json

RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.4.2

WORKDIR /app

ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/server/src apps/server/src
COPY apps/server/migrations apps/server/migrations

EXPOSE 3000

CMD ["bun", "run", "--cwd", "apps/server", "start"]
