# Admin App Migration: Next.js → TanStack Start

Migrate `apps/admin/` from Next.js App Router (`next@16`) to TanStack Start
(TanStack Router + Vite + Nitro), preserving feature parity and Canon
fail-fast conventions.

## Scope (sized from the codebase)

| Area                | Count                                                                                                              | Notes                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Page routes         | 13                                                                                                                 | incl. 5 nested under `organizations/$organizationId`                                                                    |
| Route groups        | 2                                                                                                                  | `(admin)` (auth-guarded layout), `(auth)`                                                                               |
| API routes          | 2                                                                                                                  | `api/auth/[...all]` (Better Auth catch-all), `api/desktop/models` (x-api-key)                                           |
| Server actions      | 5 files / ~16 handlers                                                                                             | `createOrganization`, `manageOrganization` (7), `organizationModels` (4), `manageSsoProvider` (3), `verifyInvitedEmail` |
| Server data modules | ~10                                                                                                                | `features/*/data/*` — currently `await`ed inline in RSC                                                                 |
| Client Next APIs    | `usePathname` ×3, `useRouter` ×2, `next/link` ×N, `next/font`, `next-themes`                                       |
| Infra               | `next.config.ts`, `postcss.config.mjs`, `Dockerfile` (standalone), `tsconfig`, `turbo.json`, `portless … next dev` |

## The three hard parts

1. **RSC → loaders + server functions.** Pages `await` data modules directly in
   server components. Start has no RSC: wrap each `features/*/data/*` reader in
   `createServerFn`, consume via route `loader` + `Route.useLoaderData()`.
   `notFound()` → `throw notFound()` in the loader.
2. **Better Auth on Nitro/Start.** Drop `better-auth/next-js`
   (`toNextJsHandler`, `nextCookies`). `api/auth/[...all]` → a `$.ts` server
   route calling `auth.handler(request)`. Cookie writes move from the
   `nextCookies()` plugin to Start request/response handling. Auth guards in
   `(admin)/layout.tsx` move to a pathless layout route `beforeLoad`.
3. **Actions → `createServerFn`.** `revalidatePath()` → client
   `router.invalidate()` after the call. `redirect()` → `throw redirect({ to })`.
   `headers()` → `getWebRequest()`/`getHeaders()` from
   `@tanstack/react-start/server`.

## Decisions (defaults)

- **Bundler:** Vite (guide default, matches desktop app).
- **`revalidatePath` replacement:** client `router.invalidate()` after mutations.
- **`next-themes`:** keep; only replace with inline theme script if SSR flash appears.
- **Routes directory:** keep `app/` (`routesDirectory: 'app'`) to minimize churn.

## Phases

### Phase 1 — Toolchain swap

- Remove `next`, `@tailwindcss/postcss`; add `@tanstack/react-router`,
  `@tanstack/react-start`, `nitro`, `vite`, `@vitejs/plugin-react`,
  `@tailwindcss/vite`.
- `vite.config.ts`: `tanstackStart({ router: { routesDirectory: 'app' } })`,
  `tailwindcss()`, `viteReact()`, alias `@/*`.
- `package.json` scripts: `vite dev` / `vite build` / `node .output/server/index.mjs`;
  fix the `portless … next dev` dev wrapper.
- `tsconfig`: stop extending `@kira/tsconfig/next.json`; drop `next-env.d.ts` and
  `.next` includes.
- Delete `next.config.ts`, `postcss.config.mjs`. Add `router.tsx`,
  `routeTree.gen.ts` (generated).

### Phase 2 — Root + shell

- `layout.tsx` → `app/__root.tsx` (`createRootRoute`, `HeadContent`, `Scripts`,
  `Outlet`). Replace `next/font/google` Geist with `@fontsource-variable/*` +
  `@theme` in `globals.css`.
- `(admin)/layout.tsx` → pathless `_admin` layout route; auth/role guard in
  `beforeLoad`.

### Phase 3 — Routes

- Rename per the routing table; `$organizationId`, `notFound()` → loader throws.
- `next/link` → `Link to=`, `usePathname` → `useLocation`/`useMatchRoute`,
  `useRouter` → `useRouter`/`useNavigate`.
- `searchParams` (sign-in `invitationId`) → `validateSearch` + `Route.useSearch`.

### Phase 4 — Server functions & data

- Wrap `features/*/data/*` readers + the 16 action handlers in `createServerFn`.
- Rewire `headers()` / `revalidatePath` / `redirect`.
- Convert both API routes to server routes.

### Phase 5 — Env & auth wiring

- `@t3-oss/env-nextjs` → `@t3-oss/env-core`; `NEXT_PUBLIC_*` client var via Vite
  (`import.meta.env` / server-passed).
- Replace all `better-auth/next-js` usages.

### Phase 6 — Deploy & verify

- Dockerfile (`output: standalone` → Nitro `.output`); `turbo.json` outputs.
- `typecheck` + `lint` + `vite build`; manual dev smoke (sign-in, org CRUD,
  desktop API-key endpoint).

## Risks

- **Better Auth cookies on Nitro** — no official Start adapter; manual
  `auth.handler` + Set-Cookie plumbing is the most likely snag.
- **Docker/Nitro deploy** drift from the previous standalone output.

## As-built notes (SPA mode)

The app ships as a **client-rendered SPA**, not SSR:

- `vite.config.ts`: `tanstackStart({ spa: { enabled: true }, srcDirectory: ".",
router: { routesDirectory: "app" } })`. The build prerenders a single
  `/_shell.html`.
- `start.ts`: `createStart(() => ({ defaultSsr: false }))` disables server-side
  `beforeLoad`/`loader`/component execution for all routes. `spa.enabled` alone
  did **not** stop the Nitro node server from SSR-ing matched routes (it only
  added a 404→shell fallback); `defaultSsr: false` is what makes every page
  route serve the shell and run guards/loaders on the client.
- `app/__root.tsx` uses `shellComponent` (the only server-rendered piece:
  `<html>` + `HeadContent` + `Scripts`) plus a client `component` that mounts
  `ThemeProvider` + `Outlet`. The router has a `defaultPendingComponent` (the
  shell's fallback).
- **CSS gotcha:** the shell stylesheet must be a _side-effect_ import
  (`import "./globals.css"` in `__root.tsx`), not `?url`. With `?url` the shell
  is prerendered from the SSR build and links the SSR-hashed CSS file, which is
  not served from `/assets` → unstyled production. The side-effect import is
  manifest-managed and links the client-hashed asset.
- Better Auth needed no manual cookie plumbing: the catch-all `app/api/auth/$.ts`
  server route returns `auth.handler(request)` directly (Set-Cookie flows through
  the Response). `setActiveOrganization` writes the active org to the session row
  in the DB, so no cookie forwarding was required.
- Client env (`VITE_BETTER_AUTH_URL`) lives in `lib/env-client.ts`; it must
  **not** match the `**/*.client.*` import-protection deny pattern, so the file is
  named `env-client.ts` (not `env.client.ts`).

Verified: `tsgo --noEmit`, `oxlint`, `oxfmt --check`, full `vite build`
(client + SSR + Nitro + shell prerender), and browser smoke against both the
`bun run dev:admin` (portless) dev server and the production `node
.output/server/index.mjs` — sign-in renders/styled, `/dashboard` guard redirects
to `/sign-in` client-side, `/api/auth/get-session` returns JSON from the DB.
