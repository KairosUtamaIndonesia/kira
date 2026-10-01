# A ticket carries its conversation, its history, and its pull requests

Date: 2026-10-01

Amends ADR 0010 (a project now holds its repositories) and ADR 0024 (a merged pull request moves a ticket to Done; a ticket gains comments and a timeline).

## Context

ADR 0024 made Work a store and left two known gaps in writing. The first: Kira's ticket surface is thin. A ticket has fields and blocked markers but no conversation and no history — an agent can change a status with no record of why, and two people cannot discuss a ticket on the ticket. The closest reference is Multica's issue surface, whose comments and activity timeline are exactly what is missing.

The second: ADR 0024 closed with _"Done after a merge is manual. Nothing tells Kira a pull request merged, so the person sets Done."_ Kira holds one `pullRequestUrl` string that an agent types in; nothing watches the pull request, and nothing connects a project to the repositories its work happens in.

ADR 0010 named the repository gap too: _"The first time a run must make its own workspace … a project needs a list of repositories to build one from. That is a field on the project, not a level above it, and it is not built until a run needs it."_ A pull request that is watched by the server is the first thing that needs it.

Multica has built both surfaces and is the reference for their shape. It also supports more than one Git host: GitHub through an App installation, and Forgejo, Gitea and GitLab through per-connection tokens. Kira is one company's server, so it does not need Multica's per-workspace fan-out or its cross-workspace link policy — but it should not design itself into GitHub alone either.

## Decision

**A ticket gains a conversation and a history, and they are read as one timeline.** A comment is written by a person or by Kira; a reply names its root with one level of nesting. An activity row is written by the server when a ticket changes: status, priority, assignee, title, body, a blocker added or removed, a pull request linked or merged, an Outcome recorded. `GET /api/tickets/:ref/timeline` merges the two by `(createdAt, id)` and returns them oldest first.

**Kira's domain is unchanged.** Kinds, Outcomes, Decisions, the Glossary, the stored status and the blocked marker stay as they are. This adds surfaces beside them, not a second model.

**A project holds its repositories, and a ticket holds its pull requests.** A repository is a provider, an owner and a name, attached to a project; it is ADR 0010's named field and the thing a run will clone from. A ticket holds its pull requests as rows — open, draft, merged or closed — rather than one URL.

**The connection is provider-agnostic, and GitHub is the first provider.** A connection records a provider, an auth kind, and what that kind needs: GitHub is an App installation with credentials in the environment; Forgejo, Gitea and GitLab are a token-based connection with an instance URL, an access token and a webhook secret. The token-based path stores both secrets encrypted at rest under a Kira key; the App path stores nothing, because its installation tokens are minted live. Forgejo and Gitea share one adapter, being wire-identical.

**A pull request names its ticket by the name people say.** `FND-12` is the project's prefix and the ticket's number, and a project prefix is globally unique, so the reference resolves to exactly one ticket. A link is claimed from the pull request's title and its branch, never from a bare body mention. A merged pull request moves a ticket in Needs review to Done; it never sets Won't do, and it never touches a ticket a person has already closed.

**The timeline is read, not pushed.** Kira has no realtime channel, and the Work surface refetches on `updatedAt`. Nothing here adds one.

## Considered options

- **Copy Multica's issue model.** It would replace Kira's stored status, kinds, Outcomes, Decisions and Glossary with a generic issue, throwing away the domain that ADR 0017, 0020, 0021 and 0024 built. The surfaces are what is missing, not the model.
- **GitHub only.** Cheaper to start, and wrong to design around: a company running Kira's local-first posture is as likely to self-host Gitea or GitLab, and retrofitting a token connection into a schema shaped for an App installation is the expensive part. The adapter is cheap; the schema is not.
- **Two parallel table sets, as Multica has.** Multica splits GitHub from the token providers because their CI models differ enough to justify it. The pull-request shape does not differ, and Kira has one tenant, so one set of tables with a `provider` column is smaller and loses nothing.
- **A separate `activity_log` written by an event bus.** Kira has no event bus, and building one to carry ticket updates is more machinery than the feature. The server writes activity where it already writes the change.
- **Pushing timeline events over a socket.** The desktop is one window and already refetches; a channel would be built before anything needs it.

## Consequences

- **ADR 0010's repository limit is closed.** A project lists repositories, which is also what a headless run will later clone from.
- **ADR 0024's manual Done is closed for the ordinary case.** A merge moves Needs review to Done; a checkout with no remote, or a pull request Kira cannot see, still leaves the person to close the ticket.
- **Kira can comment on a ticket.** The tracker tools gain a comment tool, so an agent that changes a status can say why on the ticket. `authorKind` is asserted by the client, because the desktop holds the person's key and the server cannot tell Kira from the person without minting agent identities; that is a deliberate boundary to revisit if agent-authored writes ever need to be unforgeable.
- **Activity is written on the paths that exist today** — the ticket update route and the blocker routes. Status transitions reached through a breakdown, an Outcome approval or a merge should record activity as they are touched; until then the timeline is complete for edits and sparse for those transitions.
- **Comments are tombstoned, not deleted,** when they have replies, so a thread does not dangle. A comment with no replies is removed outright.
- **CI status is deliberately not modelled.** GitHub check suites, GitLab pipelines and Gitea commit statuses differ the most of anything here, and a pull request that is reviewed on its host does not need Kira to render its checks.
- **A host is connected with a token, or GitHub as an App.** An administrator connects a host (`POST /api/git/connections`) and is handed the webhook secret once; the host's webhook points at `/api/webhooks/git/{connectionId}`, and the secret is stored sealed under `KIRA_GIT_SECRET_KEY` and never read back. Where the GitHub App's credentials are configured (`KIRA_GITHUB_APP_SLUG`, `KIRA_GITHUB_APP_ID`, `KIRA_GITHUB_APP_PRIVATE_KEY`), `GET /api/git/github/connect` hands back its install URL and `GET /api/git/github/setup` records the installation; GitHub is watched through that, through a token connection like any other host, or through the environment secret at `/api/webhooks/github`.

## Sources

- Multica's comment and activity schema: `server/migrations/001_init.up.sql`, `017`, `018`, `025`, `069`, `471`; handlers `server/internal/handler/comment.go`, `activity.go`.
- Multica's Git integration split: `server/migrations/079_github_integration.up.sql` and `216_vcs_integration.up.sql`; `server/internal/integrations/vcs/vcs.go`; `server/internal/handler/github.go`, `vcs_webhook.go`.
- Kira's tracker: `apps/server/src/tickets.ts`, `apps/server/src/schema.ts`; ADR 0010, 0017, 0024.
