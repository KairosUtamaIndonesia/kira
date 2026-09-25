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

**Not built yet:** the server does not serve `apps/admin/dist`. Production serving — and the
cache headers and CSP that go with it — is the next step. Today the console runs only on its
dev server, and the address it will answer on is a decision already made rather than one
already implemented.

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
  main.tsx    reads everything, then draws; the theme is applied here
  App.tsx     one value in, one of four screens out
  api/        the only place that calls the server
```

Folders are kinds of code, as in the desktop ([`desktop-conventions.md`](./desktop-conventions.md)):
`api/` is the web's answer to the desktop's `ipc/`, and nothing else in the app reaches for the
network.

A screen is added by giving `api/` a module for its route group, adding its outcome to `Opening`
in `api/opening.ts`, and giving `App.tsx` a case that draws it. The switch is exhaustive —
adding an outcome without a screen for it stops the build rather than drawing nothing.

## Checks

```sh
bun run --cwd apps/admin typecheck
bun run --cwd apps/admin test
bun run build:admin
```

The tests are `bun test` over the console's own modules, which is why `test` is a
script of its own here: what the console draws is checked by driving it, and what it
works out for itself — how a number reads, whose number it is — is checked here.
