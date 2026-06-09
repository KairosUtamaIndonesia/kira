# 0005. Build the Hosted Admin App with TanStack Start in SPA Mode

## Status

Accepted

Supersedes the Next.js framing of the admin app in ADR 0002 (the monorepo and
hosted-admin boundary decisions there still hold).

## Context

The hosted admin app (`apps/admin`) was originally built on Next.js App Router
(`next@16`) with React Server Components and server actions, as described in
ADR 0002. In practice the admin panel is an internal, authenticated tool: there
is no SEO requirement, no anonymous traffic, and no need to server-render page
content. The RSC/server-action model added framework coupling (`next/*`,
`better-auth/next-js`, `@t3-oss/env-nextjs`, `revalidatePath`) and a standalone
Docker output that did not pull its weight for this surface.

The rest of the monorepo already standardizes on Vite (the desktop frontend),
so aligning the admin app on Vite reduces the number of build toolchains the
team maintains.

## Decision

The admin app is built with **TanStack Start** (TanStack Router + Vite + Nitro),
running in **SPA mode**.

- Page routes are client-rendered. SPA mode is enabled with `spa.enabled` in
  `vite.config.ts` plus `createStart(() => ({ defaultSsr: false }))` in
  `start.ts`. Only the root `shellComponent` is server-rendered (`<html>`,
  `HeadContent`, `Scripts`); route `beforeLoad`/`loader`/components run on the
  client.
- Data loading uses route `loader`s that call `createServerFn`; reads come from
  `Route.useLoaderData()`.
- Mutations are server functions
  (`createServerFn({ method: "POST" }).validator(...).handler(...)`), invoked as
  `fn({ data })`. Clients call `router.invalidate()` after a successful mutation
  instead of `revalidatePath()`.
- Navigation control uses thrown TanStack primitives: `throw redirect({ to })`
  and `throw notFound()`.
- Better Auth is wired through a catch-all server route that returns
  `auth.handler(request)` directly; there is no Next.js auth adapter.
- Environment access is split: server env in `lib/env.ts` (`@t3-oss/env-core`),
  client env in `lib/env-client.ts` via `import.meta.env` with `VITE_`-prefixed
  variables.
- The app deploys as a Nitro node-server output (`.output/server/index.mjs`),
  replacing the Next.js standalone Docker output.

The monorepo structure, the hosted-admin/desktop boundary, and Postgres as the
admin's persistence store (ADR 0001, ADR 0002) are unchanged.

## Rejected alternatives

- **Stay on Next.js App Router**: rejected because SSR/RSC provide no value for
  an authenticated internal admin panel and impose framework-specific APIs and a
  separate build toolchain from the rest of the repo.
- **TanStack Start with SSR enabled**: rejected because server-rendering admin
  pages adds latency and server-side auth-redirect complexity with no payoff;
  `defaultSsr: false` keeps guards and loaders on the client.
- **Plain TanStack Router SPA (no Start)**: rejected because Start's server
  functions and server routes give a typed, co-located boundary for Better Auth
  and Postgres access that a router-only SPA would have to hand-roll.

## Consequences

- There is no SSR for admin page content; the server runs only server functions,
  server routes, and the prerendered shell.
- Server-only access (Postgres, Better Auth, `@/lib/env`) must stay inside server
  function handlers or server routes; client code may only read `@/lib/env-client`.
- The shell stylesheet must be a side-effect import in `app/__root.tsx`
  (`import "./globals.css"`), not a `?url` import, so the client manifest links
  the correct hashed asset.
- Deploy and CI config target `.output/**` (Dockerfile, `turbo.json`); the
  previous `.next` artifacts no longer exist.
- ADR 0002's description of the admin app as "Next.js" is superseded by this ADR.
