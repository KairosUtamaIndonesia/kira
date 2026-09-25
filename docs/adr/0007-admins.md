# An admin is a Foundry role, granted out of band once and changed in the console

Date: 2026-09-18

## Context

ADR 0004 makes the Entra tenant the whole restriction: every employee in the company can
sign in, and nothing after sign-in tells one from another. That was right for the desktop,
where every employee is a peer — one person's chat is their own business, and the app asks
for nothing but a model.

An administration console breaks that assumption. Managing users, allowances, keys and the
credential pool means some people may do things to other people's accounts. ADR 0005 already
assumes such a person exists — "a per-user row overrides it", "the operator's recourse is
the same number that caused it" — without ever giving them a shape. Nothing in the codebase
does either: there is no role, no flag, and no allowlist.

This adds a check of Foundry's own, which ADR 0004 said it had none of. The distinction
that keeps both true: ADR 0004's rule is about **identity** — no claim from the identity
provider decides access, and tenant pinning is the whole of "may this person in". A role is
about **authority** — how much of Foundry a person who is already in may touch. Sign-in is
unchanged; the check happens after it, and only for the console.

## Decision

**An admin is a `role` on the Foundry user**, from Better Auth's `admin` plugin. It is a
second question asked of a row that already exists, not a second identity: there is no
admin account, no admin password, and no second sign-in. Everyone arrives the same way, and
the role decides what the console will do for them.

**The role lives in the database, because the console changes it.** That is the whole point
of a column over a configuration list: an allowlist in the environment would mean a deploy
to promote someone, which is what "manageable from inside the console" rules out.

**It is not self-served.** `role` is declared `input: false`, so no API sets it from client
input, and the plugin's `set-role` endpoint checks the caller's own role first. A person
cannot promote themselves, and the ordinary update path cannot promote anyone by accident.

**The first admin is granted out of band**, by `admin.ts` — `bun run --cwd apps/server admin
<email>`. Nobody holds the role until someone says so, and the only thing that can say so
is a role. Ungating that one write is smaller and more visible than any seed, and the same
command is what gets an administrator back in after the last one is gone: the console can
take the role away from everyone, including whoever took it. The runbook is in
[`../internal/server-development.md`](../internal/server-development.md).

**Not an Entra group.** The company already has a group for the people who run internal
tools, and that would be the natural home for this — the organisation's own answer, kept in
the organisation's own system. It is parked rather than rejected: ADR 0004 installs no claim
check on the way in, so reading a group means verifying an identity-provider claim or calling
Graph, and that is a decision of its own rather than a detail of this one.

## Consequences

The desktop is unaffected. Every employee still signs in, still gets a key, and the role
gates nothing the app does — only the console.

A user row written before the role existed holds no role, and the plugin reads that as the
ordinary one. So `role` is either a value or absent, and both mean the same for anyone but
an admin; a reader that treats "no role" as a third state would show a distinction that does
not exist. Rows created since carry `user` explicitly.

The plugin's `set-role` has no guard against removing the last admin. A console can therefore
lock everyone out, including itself, and the out-of-band command is what makes that
survivable rather than fatal. If the console grows a guard of its own, this stops being the
only way back.

The server gains the plugin's own surface at `/api/auth/admin/*` — list users, set a role,
ban, revoke sessions, impersonate — gated by the same role. It shares the prefix with
Better Auth's other routes because it is the library's surface; Foundry's own administrative
routes are a separate thing at `/api/admin/*`.

The role is one column, so it holds one word at a time. The plugin also accepts several,
comma-joined, which is where a second grade (support, read-only) would go when someone needs
one — not before.

## Revisit when

Admin membership should follow an Entra group, or a second grade of administrator appears.
