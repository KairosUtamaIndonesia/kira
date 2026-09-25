# Kira's server keeps its state in Postgres, and Drizzle owns the schema

Date: 2026-09-18

## Context

The server began on SQLite — `node:sqlite`, a file at `apps/server/data/kira.sqlite`. That
is the right shape for the desktop, which keeps one person's chats on one person's machine.
It is the wrong shape for the platform. What the server holds is a whole company's users,
their sessions and device keys, and the ledger of what each request used. That is concurrent
writers, and it is a thing to back up, to restore, and to move between machines without
copying a file out of a running process.

There was no ORM. Better Auth migrated its own tables through its Kysely adapter, and Kira
hand-wrote the ledger in SQL with a `PRAGMA user_version` gate — the arrangement ADR 0005
records. So one database had two owners and two migration systems, and every Kira query
was SQL written as a string, with the column names typed out again in the mapper beside it.

Two things make this the moment. The server has never been deployed, so the only database in
existence is development data and there is nothing to migrate. And the next work is the model
path — usage recorded per request, an allowance enforced from it — which will add several
tables and a great deal of querying on top of this. Settling persistence after that means
migrating real rows.

## Decision

**Postgres, in an instance of Kira's own.** `compose.yaml` runs `postgres:18-alpine` on
port **5439** for development and tests; `KIRA_DATABASE_URL` points at it, defaulting to
that instance the way the pool settings default to the development chain. Production sets it,
and there it is a secret, because the URL carries the password.

**Drizzle owns the schema, and Better Auth reads its tables through Drizzle's adapter.**
`src/schema.ts` describes every table in the database — Better Auth's five and Kira's one —
and `drizzle-kit` generates the statements in `migrations/`. The server applies them at boot,
so a checkout and a deployment run the same statements in the same order with no step in
between to forget.

The adapter is the part that matters. Better Auth migrating its own tables is not wrong, but
keeping it would have left two migration systems in one database — the thing the SQLite
arrangement already cost, carried forward into a longer-lived store. With the adapter, Better
Auth stops migrating anything and the schema file is the single description of what the
database should be.

**Better Auth's names are kept.** Its adapter looks a field up by the name Better Auth uses —
`schema["userId"]`, not `schema["user_id"]` — so its columns are `userId`, `createdAt`,
`emailVerified`. Kira's `usage` table follows them rather than using Postgres's usual
snake_case, because two naming conventions in one database is worse than either one.

**Nothing was written from memory.** Better Auth's own migrations were run against a scratch
database and the result dumped, and the schema was written to reproduce that dump: the same
names, types, nullability, unique columns and indexes. The two databases were then built side
by side and everything a reader could notice about them compared — 83 things each, no
difference. `docs/internal/server-development.md` says how to repeat that after a Better Auth
upgrade, which is the one thing this decision asks of the future.

## Consequences

**The version gate is gone, and nothing replaces it exactly.** SQLite gave Kira a number it
could refuse to open past: a database written by a newer build stopped the older one rather
than being misread. A Postgres database carries no such number. Drizzle's journal records
which migrations were applied, which makes migrating repeatable and ordered — but it does not
stop an old build from running against a database a newer build has already changed. That is a
real reduction in safety, accepted because nothing is deployed and the alternative is
maintaining a private version row for a case that has not arisen. If Kira ever runs two
versions at once, this is the thing to revisit.

**Migrations run at boot, which is safe for one server and not for two.** Every boot applies
whatever the database has not seen, including a hot reload and the admin CLI, so a fresh
checkout needs no step between cloning and running. Two processes booting at once would race.
That is written where the code is (`src/database.ts`), and it is what to fix before there is a
second instance.

**Tests need a Postgres running.** `docker compose up -d --wait` is now part of setting the repo
up, and it is the one cost this decision adds to an ordinary working day. Against it, one
database holds every test's tables: each boot empties it and runs the real migration again, so
the statements under test are the ones production runs and no test can see another's rows. That
is about 88ms a boot across 58 of them.

The first attempt gave each boot a database of its own, which is the more obvious thing and was
measured at 353 of them and 2.8GB on the development machine. Creating one cost 66ms; _dropping_
one cost 180ms, which put a file's teardown past the time a test runner allows a hook — so the
cleanup silently did not happen, and the leak was invisible until the databases were counted.
Emptying one database and re-migrating it costs 88ms, cannot fail half-done, and leaves nothing
to clean up. Where a test genuinely needs a database rather than a server, `freshDatabase` still
hands out one that has just been migrated from empty.

**One query language instead of two.** The ledger's tests kept their claims and lost their SQL:
three of the five are left, and only one left for a reason — refusing a database written by a
newer build was about the pragma, which is gone. The claim that migrating twice is harmless did
not leave; it moved to the test in `app.test.ts` about booting twice against one database, which
is the thing that would break if it stopped being true. Names in the schema are checked at
compile time, and a test that deletes a user says `DELETE FROM "user" WHERE id = ${ada.id}`
through Drizzle rather than assembling a string.

**ADR 0005's reasoning about one store still holds, and its wording does not.** The ledger and
the people it is about must be in one database because a foreign key cannot point into
another one; that was true of a SQLite file and it is true of a Postgres database. What that
ADR called "one SQLite file, two owners" — Better Auth migrating one half and Kira
hand-writing the other — is superseded here, and its text has been corrected.

**The desktop is untouched, with one exception that is not this ADR's business.** It keeps
SQLite for chat history, which is local state on a user's own machine and has nothing to do
with the server's database. A run's transcript is that exception: it belongs to a ticket, so
it lives with the project (ADR 0012), while a person's own chats stay where they are.

**Revisit if** a second server instance appears (move migrations out of boot), if Better Auth
ever needs tables the adapter cannot express (then its own migrations come back, deliberately),
or if a non-TypeScript consumer needs the schema.
