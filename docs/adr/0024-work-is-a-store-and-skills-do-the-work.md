# Work is a store, and skills do the work

Date: 2026-09-30

Amended: 2026-10-01 — the project, not ticket attachments, is the agent's access boundary.

Supersedes ADR 0012, ADR 0013, ADR 0019 and ADR 0023. Amends ADR 0011, ADR 0017 and ADR 0021.

## Context

ADRs 0011 to 0013, 0019 and 0023 built a job system on top of the ticket store: a claim held with
a lease and a heartbeat, a worker that offers itself, a run that ends as a proposal with a
verdict, an execution workspace per ticket, a spec branch pushed to the project's remote, and
delivery. Each exists to answer "who is doing this, and did it land?" for an agent nobody is
watching.

The first end-to-end pass through it (2026-09-30, a new project in an empty folder) showed what
that costs. A ticket could not start until the folder was a git checkout with a reachable
`origin`, because the spec's branch is pushed before any run begins. The agent finished without
committing, the person accepted, and acceptance merged an empty branch and closed the ticket as
Done with nothing in it. The verdict was recorded; nothing checked that work had landed.

The shaping half needed none of that. The interview, the spec, the breakdown and their approval
cards need only the store and the skills (ADR 0022). The skills the store was modelled on
(`/to-spec`, `/to-tickets`, `/implement`, `/pr`) already assume something simpler: the agent works
in a session the person is in, in their own checkout, and a tracker is where the work is written
down. They were written against several trackers (local files, GitHub Issues), so what Kira owes
them is one more: a store with the same few operations.

At the time this decision was made, the server already held most of the store. Tickets had a
stored `status` (`backlog`, `todo`, `in-progress`, `in-review`, `done`, `cancelled`), an assignee,
tags, blockers and children. The desktop ignored that status and derived its own bands from claims
and runs.

## Decision

**Work is a store.** Projects, tickets, blockers, Decisions, the Glossary and Outcomes, held by
Kira's server for the team (ADR 0010, ADR 0020), read and written by people through the board and
by Kira through her tools. It is GitHub Issues, in Kira. Nothing in it runs anything.

**A ticket has one stored status, and an assignee.** The status is Draft, Ready, Running, Needs
review, Done or Won't do (the server's `draft`, `ready`, `running`, `needs-review`, `done`,
`wont-do`). People may set any status; an open blocker adds a Blocked marker without changing it.
`gate`, `closure` and the derived band go.

**The person's request starts work.** Kira works requested tickets in the chat's current project
with the skill each kind names (ADR 0022), whether attached or not. Attachments supply context.
When work begins, setting Running records the chat link and assigns the chat's person. Reading a
ticket or editing ordinary fields does not create a work link. There is no separate Start action,
and no claim, lease, heartbeat, worker or run. A ticket stays Running until someone changes it.

**The current project is the access boundary.** Kira's ticket tools create, read and update tickets
and edit blockers in that project, as the person's request calls for; attachments grant no extra
access. Both ends of a blocker must belong to the current project. Kira cannot delete tickets.
A ticket created by the agent is Draft and linked to that chat. A person makes it Ready when it
is ready to start. The agent may set only Running or Needs review as a status. Done and Won't do,
publishing tickets, and approving a spec or Decision stay a person's press (ADR 0022).

**A pull request is the review.** When the work is done and the checkout has a remote, Kira opens a
pull request, attaches its HTTPS URL to the ticket, and sets Needs review; if publishing or opening
the PR fails, the ticket stays Running, while a checkout without a remote may reach Needs review
without a link. A ticket holds one current PR link, shown in Work as “Open pull request”; only Kira
attaches it for now, with manual attachment deferred until the GitHub integration. The chat that
opened the PR is linked to the ticket; review and merge stay on GitHub—Kira has no diff pane, review
comments, delivery, or merge—and a person marks the ticket Done after merging.

**Each ticket is its own branch off the default branch.** A ticket blocked by another should start
when its blocker is Done, which means merged, so it branches from the merged work. There is no spec
branch. A chat works the spec ticket after its children are Done and reviews them together against
the spec.

**A kind names a skill and what it leaves behind, and nothing more.** A question or research
ticket still ends in an Outcome the person approves.

## Considered options

- **Attached tickets as the access boundary.** This made an explicit request such as "work on the
  first actionable ticket" fail when the spec was attached but its implementation ticket was not.
  Extending access to a spec's children still makes attachments into permissions and fails ordinary
  requests to edit another project ticket. Project-scoped access keeps unrelated projects protected,
  while the person's request defines the work and chat links record it.
- **GitHub Issues as the store.** It is what the skills were written against. Kira already holds
  the Glossary and Decisions on the server (ADR 0020), a project can span repositories
  (ADR 0010), and the board, kinds and blockers are built. Making GitHub the store would add a
  second sign-in and an API dependency for a smaller model than the one we have.
- **Keep runs, drop the leases.** The lease is the smallest part of the cost. The verdict, the
  execution workspace and the spec branch are what made a fresh folder unusable and let an empty
  merge close a ticket.
- **Kira reviews and merges pull requests itself.** ADR 0023 did this, and it rebuilds the review
  surface GitHub already has, with the reviewers, CI and branch protection that go with it.
- **Derive the status from claims, runs and blockers (ADR 0017).** That was needed while a machine
  held claims. With a person and their chat in charge, a stored status is what GitHub Projects does
  and what people expect to drag.

## Consequences

- **Isolation goes.** Two tickets running at once share one checkout, and Kira no longer gives
  each agent a worktree. The skills can branch or use worktrees themselves. Revisit this when two
  running tickets colliding in one folder becomes a real complaint, not before.
- **The per-run record goes.** A ticket keeps its linked chats, a chat is its transcript, and the
  pull request is the record of the change. Runs, verdicts and deliveries are not kept.
- **An agent can update requested tickets in the current project.** It may set Running or Needs review;
  the person sets Done or Won't do. A successful Running update records the chat link automatically.
- **Done after a merge is manual.** Nothing tells Kira a pull request merged, so the person sets
  Done. If that is forgotten often, the smallest fix is for the agent to check its pull request
  when its chat is reopened and offer to close the ticket.
- **Two numbers in ADR 0005 need a second look:** "runs in flight" in the allowance becomes chats
  running at once, or goes.
- **Existing tickets are rewritten.** Every stored status is `backlog` today, so the migration sets
  it from the ticket's band, readiness and closure. The order of the removal and the size of each
  piece are in `docs/internal/work-store-migration.md`.
