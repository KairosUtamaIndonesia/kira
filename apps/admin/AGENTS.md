# Admin app (TanStack Start)

`apps/admin/` is a TanStack Start app (TanStack Router + Vite + Nitro) running in
**SPA mode**. There is no Next.js and no RSC.

Conventions for this app:

- Routes are file-based under `app/` (`createFileRoute`/`createRootRoute`). The
  `_admin` pathless layout route holds the auth/admin guard in `beforeLoad`.
- SPA mode is on (`spa.enabled` + `defaultSsr: false` in `start.ts`); route
  `beforeLoad`/`loader`/components run on the client. Only the root
  `shellComponent` is server-rendered.
- Load page data in a route `loader` that calls a `createServerFn`; read it with
  `Route.useLoaderData()`. Use `throw notFound()` / `throw redirect({ to })`.
- Mutations are server functions:
  `createServerFn({ method: "POST" }).validator((input: T) => input).handler(...)`,
  invoked from clients as `fn({ data: input })`. After a successful mutation the
  client calls `router.invalidate()` (there is no `revalidatePath`).
- Server-only access (DB, Better Auth, `@/lib/env`) must stay inside server
  function handlers or server routes. Client env lives in `@/lib/env-client`
  (`import.meta.env`, `VITE_`-prefixed).
- Global CSS is a side-effect import in `app/__root.tsx` so Start's manifest
  links the client-hashed stylesheet (do not use `?url` for the shell stylesheet
  in SPA mode).

## Database migrations

Drizzle migrations are the **only** way schema reaches the database. They are
mandatory, never optional — any schema change in `lib/db/*.ts` is incomplete
until a migration is generated and applied.

- After editing schema, always run both, in order:
  - `bun run db:generate` — writes a new `drizzle/NNNN_*.sql` and journal entry.
  - `bun run db:migrate` — applies it and records it in the `__drizzle_migrations`
    ledger.
- Never apply schema with `drizzle-kit push`. It writes to the DB without
  recording a ledger entry, which desyncs the ledger and makes the next
  `db:migrate` start from `0000` and fail with "already exists". The `db:push`
  script has been removed for this reason; do not re-add it.
- Commit the generated `drizzle/*.sql` files and `drizzle/meta/*` together with
  the schema change. A schema edit without its migration is a broken change.
