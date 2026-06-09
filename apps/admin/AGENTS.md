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
