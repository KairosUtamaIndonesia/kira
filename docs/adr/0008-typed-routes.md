# A Kira client is typed by the server's own routes, not by a copy of them

Date: 2026-09-18

## Context

Two clients talk to the Kira server: the desktop app's main process, and the
administration console. Better Auth's surface has always been typed on both sides, because
Better Auth ships a client that knows its own routes — `createAuthClient` in
`apps/desktop/src/main/auth/kira.ts` and in `apps/admin/src/api/auth.ts`. Kira's own
routes had nothing of the kind. There was exactly one of them, `GET /api/me`, and the
desktop called it with a bare `fetch` and read the answer as `unknown`.

One route, so the cost looked like nothing. It was not nothing. The server answers that
route with the person, flat — `{ id, email, name }` — and the desktop read it as
`{ user: … }`, which is the shape of a different endpoint's answer. So every key that was
actually valid was reported as "the server could not say", and the branch that used the
server's fresh answer was unreachable. Nothing failed loudly, because both branches sign the
person in; the app simply never believed the server. The shape of a person was also written
down by hand three times: in the route's own schema, in the desktop's `AuthUser`, and in the
console's `Who`.

Two things make this the moment to settle it. The next routes are Kira's own — ADR 0005's
allowances and ADR 0003's credentials — and both have bodies and answers worth getting
right. And the server is already the shape this needs: `createApp` is a pure factory that
returns an app without listening, which is exactly what a type can be taken from.

## Decision

**Kira's own routes are typed by Eden, the treaty Elysia ships.** `contract.ts` in the
server exports `App = ReturnType<typeof createApp>`, and a client says `treaty<App>(server)`.
The types are derived from the app itself — not from a document, and not from a copy — so a
path, its body and each status it can answer with are the server's own, and a path that does
not exist does not compile.

**Better Auth keeps its own client, and both sit in an app at once.** The line is who wrote
the route: `/api/auth/*` is the library's surface and the library's client types it, and
everything Kira wrote is Eden's. Two clients in one app is the intended shape rather than
a wart — they answer different questions, and replacing either would mean re-typing something
that is already typed by whoever owns it.

**The contract is the only thing the server package exports.** `apps/server/package.json`
declares one subpath, `./contract`. A client that could reach `./app` could import the server
itself, and a browser window that did would try to carry Elysia, Better Auth and a Postgres
driver with it — so the footgun is closed by construction rather than by remembering.
Clients import it with `import type`, so nothing crosses at runtime; grepping the built
desktop for server code is what checks that, and it finds none.

**Eden types a call; it does not check an answer.** So the runtime guard stays. `isAuthUser`
still runs on whatever arrives, because compile-time types are a claim about the server and
not a property of the bytes. Worth stating plainly, since it is the reason the bug above was
possible at all: the guard takes `unknown`, so it would have accepted the wrong shape too.
What the types changed is that the _right_ shape is now the one written at the call site.

**The desktop stopped building with `tsc -b`.** This is the price of the decision, and it is
worth naming exactly. A composite project may consume another project's _emitted
declarations_ and nothing else (TS6307), so reading the server's types as source is not
allowed. Making the server emit declarations means annotating the options it hands Better
Auth — and that type cannot be named without a reference to a package-internal one (TS2883),
so the annotation must either name that internal path or widen to `BetterAuthOptions`, which
drops the plugins' own methods such as `verifyApiKey` off the type. Either way it is a
hand-written mirror of the library's options, growing every time Kira sets another one,
sitting in the server's most delicate file — so that a _client_ can be typed. The smaller
change is on the client side: `apps/desktop/tsconfig.node.json` and `tsconfig.web.json` are
no longer composite, and the app typechecks with `tsc --noEmit` per project. Nothing that
ships changed, because Electron's build never used `tsc`. `packages/theme` stopped emitting
declarations for the same reason: with no references left anywhere, that output was written
and never read.

**Rejected: generating types from the OpenAPI document.** The server already emits a curated
one at `/openapi/json`, with Kira's routes described and Better Auth's deliberately
opaque. It types the answer but leaves the call hand-written, so it fixes half of what went
wrong and adds a generated artifact to keep in step with the server. It is the way out if
Eden stops fitting — see _Revisit when_ — not the plan.

**Rejected: a shared package holding the domain's nouns.** It would either duplicate the
server and drift from it, or re-export Eden, which is a pass-through with no behaviour. The
duplication that is real is the person written three times — but that is one route's wire
shape, and Eden derives it now. A package for `{ id, email, name }` earns its place when the
server speaks the domain, which is when allowances and credentials give it more than one noun
to hold. And if one is ever built, the thing worth sharing is a validator rather than types:
both sides genuinely _run_ a check, the server on what it is handed and `isAuthUser` on what
the desktop reads back off disk.

## Consequences

The clients now read the server's source to be typed, so a type error anywhere in the
server's graph fails a client's typecheck too. That coupling is the decision — it is real,
it is deliberate, and it is what replaces two copies staying in step by hand.

The desktop lost incremental typechecking. Correctness is untouched; only the wait is.

Eden is version-sensitive: its conditional types only match when the client resolves the same
Elysia the server does. Kira pins eden 1.4.9 against the server's elysia 1.4.x, and both
resolve to one copy in the store — a second copy of Elysia is the thing to look for first if
the client's calls stop being typed.

The console calls no Kira route yet, so it has no Eden client. It gets one with the first
route it actually calls, rather than an unused client now.

The bug this ADR opens with would not have been caught by the compiler on its own, and that
is the honest reading of what type-safe contracts buy here: they make the server's shape the
obvious thing to write at the call site, not a proof that what arrived is what was promised.

## Revisit when

A client that is not TypeScript appears — a generated schema is the way in, and the OpenAPI
document is already there to generate it from.

Elysia's route inference becomes slow enough to notice at the call site.

Better Auth publishes a nameable instance type, which would let a composite client read
declarations again and let `tsc -b` come back.
