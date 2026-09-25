# Model credentials come from the Foundry server, not the user's machine

Date: 2026-09-16
Amended: 2026-09-20

## Context

Kira needs a model. pi's default is to read provider credentials from
`auth.json` in its agent directory (`~/.foundry/agent/auth.json` after ADR 0002),
falling back to provider env vars. That is the right design for a local CLI: the
person running it is the person paying for the tokens.

Foundry is a product, not a CLI. Users should sign into Foundry once and not
think about providers, API keys, or which model vendor is behind a given chat.
That is what "ChatGPT + Codex" implies, and it is what makes `apps/server`
worth having.

Three options were considered:

|                                     | Where the key lives          | Who the user signs into |
| ----------------------------------- | ---------------------------- | ----------------------- |
| **(a)** pi's `auth.json`            | user's machine               | the provider            |
| **(b)** Foundry-owned local storage | user's machine (OS keychain) | the provider            |
| **(c)** Foundry server              | Foundry's infrastructure     | Foundry                 |

## Decision

**(c).** Provider credentials live on the server. The desktop authenticates as a
Foundry user and never holds a provider key.

The mechanism is pi's supported provider registration, not a fork and not a
custom `streamFn` — note that `CreateAgentSessionOptions` has no `streamFn`
field, and pi's docs contain no `streamProxy` (an earlier assumption in this
project that turned out to be wrong). Foundry registers a provider of its own,
under an id of its own, on the `ModelRuntime` the desktop already builds:

```js
modelRuntime.registerProvider('foundry', {
  api: 'openai-completions',
  baseUrl: 'https://<foundry-api>/v1',
  apiKey: '$FOUNDRY_TOKEN',
  models: rememberedCatalog, // the last answer GET /api/models gave
  refreshModels: () => fetchFoundryCatalog(), // GET /api/models
});
```

**Registering beats declaring it in `models.json`**, for three reasons:

- **The id is Foundry's own, and a registered provider has no local credential
  entry at all**, so pi's credential resolution has nothing to fall back to. In
  `models.json`, `apiKey` is a _fallback_, not an override: pi uses it only when
  no credential is stored, and a stored `auth.json` credential wins. Only
  `baseUrl` is overridden unconditionally. Overriding a built-in provider —
  `openai-codex`, say — would therefore send the request to Foundry while still
  presenting the machine's own provider credential, which is the one thing
  **(c)** exists to prevent.
- **The catalog can be live.** pi's model lists are static: `models.json` cannot
  declare `refreshModels`, and core pi never calls the configured provider's
  `/v1/models`. The one network catalog it fetches is pi.dev's own overlay, added
  to a _static_ built-in provider (`DEFAULT_CATALOG_BASE_URL =
"https://pi.dev"`), and it stays off unless `allowModelNetwork`/`allowNetwork`
  is set, which the CLI sets to `false`. A registered provider's `refreshModels`
  is the supported hook for a catalog that changes, which is exactly what a
  server-owned model list is.
- **Nothing is written to the agent directory**, so there is no file to seed,
  refresh, or leave stale between sessions.

**The catalog is cached by Foundry, not by pi.** `withRemoteCatalog` — the wrapper
that supplies `stored` and `persist` to a `refreshModels` context — is applied
only to pi's built-in providers. A provider of ours is still handed a `stored`,
but there is never anything in it: the composer publishes the list we return
without a `persist` key, so pi's model store holds nothing for provider `foundry`
and the refreshed list is lost on exit. The desktop therefore keeps the last
catalog Foundry served and passes it as `models` at registration — which
registration requires — so a cold start with no network still has models, and
`refreshModels` replaces it when Foundry answers. This is a cache of the server's
answer, not a second source of truth: `GET /api/models` decides, and the cache
only remembers. It is also why the `models.json` declaration this ADR first
specified was never the fallback it looked like: writing pi's `models.json` would
make Foundry the author of pi's config, which is the thing registering was chosen
to avoid.

`$FOUNDRY_TOKEN` rather than a literal, because pi resolves an env-var-shaped
`apiKey` on every request, so the desktop can change its key without a restart.

Chat Completions because it is the shape every upstream is translated into, it
is Server-Sent Events on both sides, and a stream says what the request used.
Where it says so is not uniform — the pool appends a usage-only chunk for some
upstreams and folds the same object into the last chunk of content for others,
and it is the pool that asks for it rather than Foundry — so the last usage in a
stream is the one that counts, and a provider that reports none leaves the reply
to be counted for itself (docs/internal/research/cliproxyapi-interface.md). pi
ships no Chat-Completions-only provider, but a registered provider states its own
`api`, so that costs nothing.

The endpoint speaks OpenAI's shapes, not Foundry's. It is a compatibility seam
for pi, and it stays out of Foundry's own OpenAPI document.

`GET /api/models` answers in Foundry's own shape rather than pi's. The two would
look alike, but pi's model entry is a third-party library's internal type, and
serving it would make a pi upgrade into a Foundry release. Foundry names the
facts — id, name, context window, max output where the pool states one, input
modalities, reasoning levels — and the desktop maps them onto the registration
entry, stamping on the `api` and `baseUrl` it already knows. A fact the pool does
not state is left out rather than invented, and the desktop fills pi's required
fields from pi's own defaults.

**Verified in pi 0.85.1**, which settles what this ADR previously left open:

- **`models` must be supplied at registration.** `registerProvider()` is
  synchronous and `getModels()` reads the composed list synchronously, so the
  models passed there are selectable before anything has been fetched. A provider
  registered with `refreshModels` alone has no model to choose.
- **`refreshModels()` is called twice per refresh** — once with
  `allowNetwork: false`, when pi restores whatever cached state it holds, and
  again with `allowNetwork: true` once a credential resolves. The fetch itself
  never happens without `$FOUNDRY_TOKEN`: pi reaches the hook anyway, so it is
  Foundry's own code that declines, and the cached list stands in.
- **Its return value replaces the list, and only a throw preserves it.** An empty
  array is truthy, so answering `[]` erases every model the desktop had; an error
  leaves them alone. That is why the catalog endpoint refuses when it cannot
  reach the pool rather than answering an empty catalog — the two are different
  facts and only one of them is safe to relay.

**Consequence, stated plainly:** with credentials on the server, the desktop
cannot run an agent _at all_ until `apps/server` has user accounts, a
provider-compatible streaming endpoint, server-held provider keys, and quota
handling. This moves the blocker for a bootable session from a settings screen to
an auth system, and it is the largest single piece of work between the current
state and a runnable chat.

A side effect worth noting: under **(c)** there is no local credential store at
all, so credentials are the one thing that does _not_ live under `.foundry`
(ADR 0002). The seeded `auth.json` that development used to copy in was the
exception — it did live there — and it is gone.

### The seeded development path is gone

Until the catalog existed, a session ran on the developer's own pi credentials:
`scripts/seed-dev-agent-dir.mjs` copied `auth.json` and `models-store.json` from
`~/.pi/agent/` into the agent directory, and no Foundry code was involved. The
script is deleted, so a development checkout signs in like any other install —
which is why the models have to come from the server for a session to run at all,
rather than quietly from whatever credential happens to be on the machine. A
machine that ran the old script still has the two files it copied; nothing in
Foundry reads them, and removing them is not a prerequisite for anything — they
sit in pi's own agent directory, so somebody using pi itself may want them there.

One limit is left, and it is worth stating rather than implying we have solved it:

- Precedence over **(c)** comes from Foundry's provider being registered on the
  runtime under an id pi has no credential for, so local resolution has nothing
  to fall back to — not from the absence of a fallback. What Foundry itself names
  is only ever that provider, and it names a model every time: the model a chat
  asks for is looked up in the catalog, so a chat remembering one that is not
  there — including one an older install wrote — runs on the catalog's own first
  choice instead. A machine that still has credentials of its own can reach them
  by naming a provider that is not this one — through pi itself, or through an
  extension installed into the agent directory.

What is settled is the refusal itself: a desktop with no Foundry session does not
run an agent at all. No key means no models, and a session without a model is
refused rather than started, so the window shows sign-in and nothing else.

### Which model a chat runs on

The catalog decides what is offered, and in what order. The pool marks a model
`visibility: hide` when it does not want it offered — its review-only and image
models carry it — and `priority` ranks the rest, so the server relays the pool's
own answer rather than sorting ids and taking whichever came first
(`apps/server/src/pool.ts`). A pool that says nothing about either keeps offering
everything it serves, in the order it listed them.

The choice is the chat's. A chat remembers the model it runs on in its own row,
beside the branch it is being read at, and that row is what a session is booted with —
including when the model it names is gone, in which case the chat runs on the first of
the catalog and the row is rewritten to say so. A new chat starts on the model the one
before it ran on, so beginning a chat does not mean picking the same model again, while
still binding the new chat to nothing.

The row rather than pi's own record inside the conversation is what a session is booted
with, because what pi restores from a stored session is a model named by whatever wrote
the chat; naming one explicitly every time is what keeps a chat written by another
install from bringing pi's provider back into use.

Choosing another model changes the chat that is open, and pi writes the change
into the conversation, so a transcript spanning two models says which said what.

## Revisit when

Foundry ever offers bring-your-own-key as a product feature, since that would
reintroduce (b) as a supported path alongside (c). Also revisit if a second client
of `GET /api/models` appears, or if choosing a model becomes a company setting
rather than each chat's own — a default model for everybody, which would put the
choice somewhere other than the chat's own row.
