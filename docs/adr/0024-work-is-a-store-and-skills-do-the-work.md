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
cards need only the store and the skills (ADR 0022). And the skills the store was modelled on
(`/implement`, `/implement-spec`) already assume something simpler: the agent works in a session
the person is in, in their own checkout, and the tracker is where the work is written down.

## Decision

**Work is a store.** Projects, tickets, blockers, Decisions, the Glossary and Outcomes, held by
Kira's server for the team (ADR 0010, ADR 0020), read and written by people through the board and
by Kira through her tools. It is GitHub Issues, in Kira. Nothing in it runs anything.

**A ticket is draft, ready, running or closed.** Blocked stays derived from open blockers
(ADR 0017), and closed is Done or Won't do. There is no Needs review, and ready no longer says
whether an agent or a person picks it up: anyone can work a ready ticket.

**Running is the whole claim.** A ticket is running when a person has started work on it, and it
records who and since when. There is no claim record, lease, heartbeat, worker, run or takeover.
A running ticket nobody is working shows how long it has been running, and any person can stop
it, which returns it to ready. Staleness is displayed and never acted on by a clock, as
ADR 0012 already said.

**Working a ticket is a chat.** "Work on this" opens a chat in the project's folder with the
ticket attached and the skill its kind names (ADR 0022's table), and marks the ticket running.
Only a person starts it, and it spends their allowance like any chat (ADR 0005). The ticket lists
its chats. Kira has no tool to start a ticket herself.

**Done is a person's press.** A person closes a ticket (Resolve…, then Mark done or Won't do)
when they are satisfied. Nothing merges on acceptance: the skills branch and commit in the
project's folder, and the person lands the work through git as they land anything else. Kira does
not manage a branch, a worktree, a remote or a pull request.

**A kind names a skill and what it leaves behind, and nothing more.** A question or research
ticket still ends in an Outcome the person approves. A spec still has an integration pass, which
is a session on the spec ticket, started once its children are done, that reviews them together
against the spec.

## Considered options

- **GitHub Issues as the store.** It is what the skills were written against. Kira already holds
  the Glossary and Decisions on the server (ADR 0020), a project can span repositories
  (ADR 0010), and the board, kinds and blockers are built. Making GitHub the store would add a
  second sign-in and an API dependency for a smaller model than the one we have.
- **Keep runs, drop the leases.** The lease is the smallest part of the cost. The verdict, the
  execution workspace and the spec branch are what made a fresh folder unusable and let an empty
  merge close a ticket.
- **Keep Needs review as a status without the merge.** A ticket waiting for a person to look is
  already running, and looking at it is the person's own chat.

## Consequences

- **Isolation goes.** Two tickets running at once share one checkout, and Kira no longer gives
  each agent a worktree. The skills can branch or use worktrees themselves. Revisit this when two
  running tickets colliding in one folder becomes a real complaint, not before.
- **The per-run record goes.** A ticket keeps its linked chats, and a chat is its transcript.
  Runs, verdicts, review comments on diffs and deliveries are not kept. The diff pane may return
  as a Workbench tab for any chat.
- **Two numbers in ADR 0005 need a second look:** "runs in flight" in the allowance becomes chats
  running at once, or goes.
- **Existing tickets keep their state.** Anything with an open claim or an unjudged run becomes
  running; the rest follow their readiness. The order of the removal and the size of each piece
  are in `docs/internal/work-store-migration.md`.
