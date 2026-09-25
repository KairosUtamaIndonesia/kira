# Server development

Scope: running `apps/server` in development, the Postgres database it keeps its state in, the
CLIProxyAPI process it sends model traffic through, and granting the admin role the console
gates on.

## The chain

```
desktop  →  Kira server  →  CLIProxyAPI  →  a provider subscription
            (Bun, Elysia)      (127.0.0.1:8317)
```

Kira holds no provider credential. CLIProxyAPI holds the company's subscription logins and
presents them upstream; Kira presents one caller key to CLIProxyAPI and decides, from its
own records, what each user may spend. In development all three run on one machine, and the
desktop never talks to the proxy — it only ever knows the Kira server.

## The server

```sh
cp apps/server/.env.example apps/server/.env   # then fill in the Entra values
bun run dev:server
```

It listens on the port in `KIRA_BASE_URL`. Every value is validated at boot and the process
refuses to start until they are all correct, reporting every problem in one run.

**Kira's own routes type the clients that call them, from this app rather than from a
document.** `src/contract.ts` publishes `App = ReturnType<typeof createApp>` as the package's
only exported subpath, and a client says `treaty<App>(server)` against it. So adding a route is
all it takes to type the call: the path, the body and every status the route can answer with
are read from the route itself, and there is nothing to regenerate or keep in step. Better
Auth's routes are the library's own surface and stay with its own client
([`../adr/0008-typed-routes.md`](../adr/0008-typed-routes.md)).

## The database

Everything server-side lives in one Postgres database: the people Better Auth knows about, and
the rows Kira writes about them. Development and tests run their own instance, which is a
service in `compose.yaml`:

```sh
cp apps/server/.env.example apps/server/.env   # then fill in the Entra values
docker compose up -d --wait
bun run dev:server
```

It listens on **5439**, a port of Kira's own rather than Postgres's 5432, because a machine
is likely to be running another project's Postgres too. (On this one, 5432, 5433 and 5434
belong to other projects.) The server reads `KIRA_DATABASE_URL`, which defaults to that
instance, so a checkout runs with nothing to fill in. A deployed server sets it, and there it
carries the password and is a secret.

`--wait` is what the healthcheck in `compose.yaml` is for: it returns once Postgres is actually
answering, so the server's first connection does not race the container's startup. Without it
`docker compose up -d` returns as soon as the container is created, and the first `dev:server`
of the day can fail to connect.

If this checkout was run before the Foundry → Kira rename, the named volume contains a
`foundry` role and database. Compose environment variables only initialize a new cluster; they
do not rename roles or change passwords in an existing one. The checked-in `compose.yaml` keeps
the old volume key so the data is not silently replaced. Run this one-time migration against
the running development container:

```sh
docker exec -i foundry-postgres-1 psql -U foundry -d foundry <<'SQL'
CREATE ROLE kira_migration_admin WITH LOGIN SUPERUSER PASSWORD 'temporary-migration-only';
SQL
docker exec -i -e PGPASSWORD=temporary-migration-only foundry-postgres-1 psql -h 127.0.0.1 -U kira_migration_admin -d postgres <<'SQL'
ALTER ROLE foundry RENAME TO kira;
ALTER ROLE kira PASSWORD 'kira';
ALTER DATABASE foundry RENAME TO kira;
SQL
docker exec -i -e PGPASSWORD=kira foundry-postgres-1 psql -h 127.0.0.1 -U kira -d kira -c 'DROP ROLE kira_migration_admin'
```

The command preserves the existing tables and makes the default `kira:kira` development URL
work again. The temporary role has this one-time password and should be dropped as shown. A new
checkout does not need this step.

The server creates its own tables at boot. Tests do not touch this database's tables: they keep
theirs in a database of their own called `kira_test` on the same instance, which each boot
empties and migrates again, so what one test leaves behind cannot be seen by another.

### Changing the schema

Every table in the database is described in `apps/server/src/schema.ts` — Better Auth's five,
because it reads them through Drizzle's adapter and no longer migrates anything itself, and
Kira's own. Change what you want the database to be there, then:

```sh
bun run --cwd apps/server db:generate   # writes the statements into apps/server/migrations/
```

Nothing else is needed. The server applies whatever it has not already applied when it boots,
so a hot reload or a fresh clone catches up on its own and there is no step to remember. Read
the generated SQL before committing it: it is the thing that will run against a real database,
and it is the one place a rename becomes a drop.

Column names are Better Auth's own field names — `userId`, not `user_id` — because its adapter
looks a field up by that name. `usage` follows them, so the database has one convention rather
than two.

### After a Better Auth upgrade

The schema above is a copy of what Better Auth expects, so an upgrade can move out from under
it. Nothing catches that automatically: a missing column shows up as a failed query at runtime,
and only where the tests happen to reach it. So after bumping `better-auth`, check the copy
against the original rather than trusting it:

1. Build the same database twice on a scratch instance — once by letting your own schema be
   migrated, once by having Better Auth migrate itself. `getMigrations` from
   `better-auth/db/migration` still produces its version, even though Kira no longer calls
   it in `auth.ts`.
2. Dump what a reader could notice of each and compare: columns with their types, nullability
   and defaults, then primary keys, foreign keys, unique constraints and indexes, from
   `information_schema.columns`, `pg_constraint` and `pg_indexes`.
3. Write out whatever differs, delete the scratch databases, and add a migration through
   `db:generate`.

That comparison is how this schema was written in the first place, and it is the only thing
standing between a dependency bump and a column that quietly stopped existing.

## Making an admin

Signing in says which employee someone is; it never says they run Kira. That second
question is a **role** on the user, and granting it takes a session that already holds the
role — which is nothing at the start, and nothing again if the last administrator is ever
removed. So the first one, and the way back in, come from outside the console (ADR 0007):

```sh
bun run --cwd apps/server admin ada@company.example
```

Run it **after** that person has signed in. The user row exists only once Entra has said who
they are, so an address nobody has signed in with is refused by name rather than turned into
an account Kira invented:

```
ada@company.example has not signed in yet. Sign in from the desktop, then run this again.
```

The command writes the role directly, with no session and no permission to check, which is
what makes it usable in exactly the two cases where there is nobody to ask. Running it twice
changes nothing. `--cwd apps/server` is what makes Bun read `apps/server/.env`, so the
command reaches the same database the server does.

A user row written before the role existed holds no role at all, and the admin plugin reads
that as the ordinary one — so an empty value and `user` mean the same thing, and anything
reading roles should coalesce them rather than treat them as two states.

## CLIProxyAPI

**Install it once, at the pinned version.** The release is MIT-licensed and published as a
platform tarball; take the checksum from the same release rather than trusting the download.

```sh
cd "$(mktemp -d)"
BASE=https://github.com/router-for-me/CLIProxyAPI/releases/download/v7.3.7
curl -fsSLO "$BASE/checksums.txt"
curl -fsSLO "$BASE/CLIProxyAPI_7.3.7_linux_amd64.tar.gz"
grep CLIProxyAPI_7.3.7_linux_amd64.tar.gz checksums.txt | sha256sum -c -
tar -xzf CLIProxyAPI_7.3.7_linux_amd64.tar.gz
mkdir -p ~/.local/share/kira/cliproxyapi/bin
install -m 0755 cli-proxy-api ~/.local/share/kira/cliproxyapi/bin/
```

On macOS the checker is `shasum -a 256 -c -`, and the asset name is `darwin_arm64` or
`darwin_amd64`; Linux ARM is `linux_aarch64`. Change the three version strings and the asset
name together, and keep the version in step with the pin in the research note below.

**Run it.**

```sh
bun run dev:cliproxyapi
```

The first run writes `~/.config/kira/cliproxyapi.yaml` and then leaves it alone, so your
edits survive; delete the file if you want it written fresh. Arguments are passed through,
which is how the provider logins work.

| path                                                     | what it is                                         |
| -------------------------------------------------------- | -------------------------------------------------- |
| `~/.config/kira/cliproxyapi.yaml`                     | the config you edit                                |
| `~/.local/share/kira/cliproxyapi/bin/cli-proxy-api`   | the binary                                         |
| `~/.local/share/kira/cliproxyapi/auth/`               | one JSON per provider login — **real credentials** |
| `~/.local/share/kira/cliproxyapi/config.example.yaml` | the shipped example, for the knobs we do not set   |

### Signing in a provider

```sh
bun run dev:cliproxyapi -- -codex-login
bun run dev:cliproxyapi -- -claude-login
bun run dev:cliproxyapi -- -xai-login
```

Add `-no-browser` on a machine without one. The flag writes a credential file into `auth-dir`,
and the running service watches that directory — a login added while it runs is picked up
without a restart.

Those files are the company's subscriptions. They are not in the checkout and must not be:
never commit them, never copy one into the repository to make a test pass, and never run two
CLIProxyAPI processes against one `auth-dir`, which has no lock.

### The key Kira presents

`api-keys` holds one development key, `kira-dev-pool-key`. Kira's server presents it as a
bearer credential, so whatever the server is configured with has to match this. It is a
development value in a file on one machine, and must never be reused anywhere real.

### Checking that it answers

```sh
KEY='Authorization: Bearer kira-dev-pool-key'
curl -sS -H "$KEY" http://127.0.0.1:8317/v1/models | jq
curl -sS -H "$KEY" 'http://127.0.0.1:8317/v1/models?client_version=pi' | jq '.models[0]'
```

The first is the OpenAI-shaped list Kira proxies to the app. The second is the Codex-client
catalogue — the same endpoint with a `client_version` parameter — and it is the one carrying
per-model facts: context window, input modalities, reasoning levels, visibility.

## Testing without spending quota

```sh
bun run dev:upstream
```

That starts a stand-in for a provider on `127.0.0.1:8318`, serving the model list and chat
completions, and recording **every request body it receives**. The dev config already points
its `openai-compatibility` entry at it, so a chat naming `fake-model` travels the whole chain
and back. To see what CLIProxyAPI actually forwarded:

```sh
curl -sS http://127.0.0.1:8318/_requests | jq '.[] | select(.method=="POST") | .body'
```

`DELETE /_requests` clears the log. `FAKE_UPSTREAM_CACHED_TOKENS=9 bun run dev:upstream` makes
it report a cache read, which is how to watch that number survive the proxy. Delete the
`openai-compatibility` block from the config to work against real logins only.

## What this is not

The dev config binds loopback and leaves the management API off, because the management key
can read and rewrite every credential in `auth-dir`. Production is the same proxy with real
paths, a real service account, and its own decisions to make — the research note records what
those are.

## See also

- [`research/cliproxyapi-interface.md`](./research/cliproxyapi-interface.md) — what the proxy does, read from source and measured against a running instance.
- [`desktop-development.md`](./desktop-development.md) — running the app, and the deep-link entry it needs.
- [`../adr/0003-model-credentials.md`](../adr/0003-model-credentials.md) — why the provider logins are not Kira's to hold.
- [`../adr/0007-admins.md`](../adr/0007-admins.md) — why an admin is a role, and why the first one is granted out of band.
- [`../adr/0008-typed-routes.md`](../adr/0008-typed-routes.md) — how this server's routes type the clients that call them.
- [`../adr/0009-postgres.md`](../adr/0009-postgres.md) — why the server's state is in Postgres, and why one schema owns all of it.
- [`admin-development.md`](./admin-development.md) — the console that role opens, and how it reaches this server.
