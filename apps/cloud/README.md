# Kira Cloud

Hosted web app (Sign-In gateway, Platform Console, Organization Admin), built
with TanStack Start (TanStack Router + Vite + Nitro) running in **SPA mode**
(client-rendered; server functions and server routes still execute on the Nitro
server).

## Develop

```bash
bun run dev:cloud
```

This runs `portless cloud.kira vite dev` and serves the app at
`https://cloud.kira.localhost`.

## Routing

File-based routes live in `app/`. Three authorization-scoped surfaces:

- **Sign-In gateway** (`/sign-in`, `/desktop-signin`, `/invitation-accepted`):
  membership-only, no shell.
- **Platform Console** (`/_console/*`): Kira platform-admin access, guards with
  `requirePlatformAdmin()`.
- **Organization Admin** (`/org/:organizationId/*`): org-owner/admin access,
  guarded by `requireOrgRole()` on every server fn.

Data is loaded in route `loader`s via `createServerFn`; mutations are server
functions called as `fn({ data })` and the client calls `router.invalidate()`
after success.

## Adding shadcn/ui components

```bash
bunx shadcn@latest add button
```

Components land in `components/`. Import with the `@/*` alias:

```tsx
import { Button } from "@/components/ui/button";
```
