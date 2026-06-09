# Kira Admin

Hosted admin panel and API, built with TanStack Start (TanStack Router + Vite +
Nitro) running in **SPA mode** (client-rendered; server functions and server
routes still execute on the Nitro server).

## Develop

```bash
bun run dev:admin
```

This runs `portless admin.kira vite dev` and serves the app at
`https://admin.kira.localhost`.

## Routing

File-based routes live in `app/`. The `_admin` pathless layout route guards
authenticated admin pages (`beforeLoad` runs on the client). Data is loaded in
route `loader`s via `createServerFn`; mutations are server functions called as
`fn({ data })` and the client calls `router.invalidate()` after success.

## Adding shadcn/ui components

```bash
bunx shadcn@latest add button
```

Components land in `components/`. Import with the `@/*` alias:

```tsx
import { Button } from "@/components/ui/button";
```
