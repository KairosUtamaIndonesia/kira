# Work is a store, and skills do the work

Date: 2026-09-30

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

The server already holds most of it. A ticket has a stored `status` (`backlog`, `todo`,
`in-progress`, `in-review`, `done`, `cancelled`), an assignee, tags, blockers and children. The
desktop ignores the status and derives its own bands from claims and runs.

## Decision

**Work is a store.** Projects, tickets, blockers, Decisions, the Glossary and Outcomes, held by
Kira's server for the team (ADR 0010, ADR 0020), read and written by people through the board and
by Kira through her tools. It is GitHub Issues, in Kira. Nothing in it runs anything.

**A ticket has one stored status, and an assignee.** The status is Draft, Ready, Running, In
review, Done or Won't do (the server's `backlog`, `todo`, `in-progress`, `in-review`, `done`,
`cancelled`). People and agents set it; it is never derived from claims or runs. Blocked is shown
for a ticket with an open blocker, whatever its status. `gate`, `closure` and the derived band go.

**Linking a ticket is starting it.** A person links a ticket in the composer, which the app already
allows, and the agent works it with the skill its kind names (ADR 0022). When it begins it sets the
ticket Running and assigns the chat's person. There is no Work on this button, and no claim, lease,
heartbeat, worker or run. A ticket stays Running until someone changes it. Staleness is displayed
and never acted on by a clock, as ADR 0012 already said.

**The agent moves only its own ticket.** Kira gives it one tool for status and assignee. The tool
acts only on tickets linked in the agent's own chat, and only between Ready, Running and In review.
Publishing tickets, approving a spec or a Decision, and setting Done or Won't do stay a person's
press (ADR 0022).

**A pull request is the review.** When the work is done the agent opens a pull request with the
`pr` skill and sets the ticket In review. The chat that opened it is linked to the ticket. Review
and merge happen where pull requests already are, and Kira has no diff pane, review comments,
delivery or merge of its own. Where a project has no remote or no `gh`, the agent commits on a
branch and sets In review anyway, and the person merges with git. The person sets Done once it has
merged.

**Each ticket is its own branch off the default branch.** A ticket blocked by another can start
when its blocker is Done, which means merged, so it branches from the merged work. There is no spec
branch. A spec's integration pass is a session on the spec ticket, started once its children are
Done, that reviews them together against the spec.

**A kind names a skill and what it leaves behind, and nothing more.** A question or research
ticket still ends in an Outcome the person approves.

## Considered options

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
- **An agent can now change a ticket's status.** The tool is bounded to the tickets linked in its
  own chat and to the states between Ready and In review.
- **Done after a merge is manual.** Nothing tells Kira a pull request merged, so the person sets
  Done. If that is forgotten often, the smallest fix is for the agent to check its pull request
  when its chat is reopened and offer to close the ticket.
- **Two numbers in ADR 0005 need a second look:** "runs in flight" in the allowance becomes chats
  running at once, or goes.
- **Existing tickets are rewritten.** Every stored status is `backlog` today, so the migration sets
  it from the ticket's band, readiness and closure. The order of the removal and the size of each
  piece are in `docs/internal/work-store-migration.md`.
