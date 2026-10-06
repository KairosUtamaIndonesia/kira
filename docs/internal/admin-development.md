# Admin console development

Scope: running `apps/admin`, the browser console for the people who run Kira, and how it
reaches the API.

## What it is

The administrator's half of Kira: who has signed in, what they may do, and — as the routes
arrive — what they may spend and what the pool holds. It is a plain React and Vite app: no
Electron, no assistant-ui, no preload bridge. It draws with the same Astryx components and the
same `@kira/theme` as the desktop, which is the whole of why the two look alike. The theme
shares the palette and the typefaces and not the arrangement, so a screen built from different
components would still read as a different product.

## Running it

```sh
docker compose up -d --wait # the database the API keeps its state in
bun run dev:server   # the API, on the port named by KIRA_BASE_URL
bun run dev:admin    # the console, on http://localhost:4101/admin/
```

Open `http://localhost:4101/admin/` — not the `127.0.0.1` spelling of it. Kira trusts one
origin for a browser sign-in and it is the `localhost` one, so the other is refused as an
invalid origin. They are genuinely different origins rather than two names for one address,
and Vite binds whichever `localhost` resolves to first.

The origin check only covers requests that carry the session cookie, so signing in works either
way — there is no cookie to protect yet. The symptom of getting the address wrong is therefore
not a failure to sign in but a refusal to sign out, and the same refusal on every write the
console makes afterwards.

## One origin with the API

Every request the console makes is a relative `/api` path, in both environments:

- **development** — Vite proxies `/api` to the server (`apps/admin/vite.config.ts`), so the
  browser makes a same-origin request and no CORS is needed for a setup production would never
  use.
- **production** — the server serves the built console itself, on its own origin, so the
  session cookie is first-party.

Nothing in the build knows Kira's address, and the base path is `/admin/` because that is
where it will be served.

**Serving it.** The server serves the built console under `/admin/*` with an SPA fallback, a
content-security policy and cache headers (`apps/server/src/admin-console.ts`). The dev server is
still where it runs while it is being worked on; production uses the address it was always going
to answer on, and nothing in the build knows Kira's address.

## Signing in

Better Auth's own client against Better Auth's own endpoints, on the session cookie a browser
has rather than the API key the desktop presents. The two ends are the same plugin at the same
version, so the client's types are the server's schema rather than a copy of it:
`session.user.role` and `auth.admin.listUsers` exist because the server enables the admin
plugin, not because the console declared them.

That version is pinned exactly in all three apps. A range on the server alone would let a
`bun update` install a second copy — a console typed against one version of a plugin while its
server runs another is the one way this arrangement breaks.

**Signing in is not authorisation.** The console reads the role to choose which screen to draw;
the server refuses every read without it (ADR 0007).

The console reads the session once, when the page loads, and never polls. Signing in and signing
out both leave the page and come back, so there is nothing a refresh would learn — but a role is
granted out of band, by whoever runs Kira, while the page is sitting open. So the refusal
offers a way to look again, and it is the only refresh in the console.

The refusal says who to ask and nothing else. It does not name the command that grants the role:
that would tell everyone in the company who can sign in where Kira's server is and how it is
driven, and they could not run it anyway. The command is documented in
[`server-development.md`](./server-development.md), which is where it is actionable.

## Where things are

```
apps/admin/src/
  main.tsx          reads everything, then draws; the theme is applied here
  App.tsx           one value in, one of four screens out
  console.tsx       the router, and the opening data every screen reads
  consoleData.tsx   the opening data as React context
  api/              the only place that calls the server
```

Folders are kinds of code, as in the desktop ([`desktop-conventions.md`](./desktop-conventions.md)):
`api/` is the web's answer to the desktop's `ipc/`, and nothing else in the app reaches for the
network.

A screen is added as a route in `console.tsx`, reading the opening data from `consoleData.tsx`.
`App.tsx` still switches on the `Opening` value for the four states a person can be in — signed
out, refused, failed, administrator — and the switch is exhaustive, so adding an outcome without a
screen for it stops the build rather than drawing nothing. Once inside the console, the router
owns which screen is drawn.

## Checks

```sh
bun run --cwd apps/admin typecheck
bun run --cwd apps/admin test
bun run build:admin
```

The tests are `bun test` over the console's own modules, which is why `test` is a
script of its own here: what the console draws is checked by driving it, and what it
works out for itself — how a number reads, whose number it is — is checked here.
