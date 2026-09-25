# A ticket is one object with children

Date: 2026-09-21

Amended by ADR 0021: spec and map are kinds rather than shapes of a body.

## Context

The skills already publish three things to a tracker, and they are nearly the same thing.
`/to-spec` writes a spec and applies `ready-for-agent`. `implement-spec` says a spec has
tickets under it. `/wayfinder` charts a **map**: one issue whose children are questions, each
answered in one session. Read closely, all three are "an issue with children", and one of them
is already labelled as something an agent may be sent at.

The repo's triage vocabulary is a second set of nouns: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. Some name a state the work is in, one is a
question about it, and one is a way of closing it.

Keeping both sets means three nouns — issue, spec, map — for one object, and five labels for
facts that overlap: a spec is a ticket in a shape, `wontfix` is a closing, and `needs-info` is
a question someone asked.

**The three are not identical in what they owe.** A map's children are decisions: they produce
an answer rather than a change to review. That difference is real, and it has a place already
— it is a difference in what a run of the ticket owes, which is what a kind is for (ADR 0011)
— not a difference in what a ticket _is_. Three objects would mean three sets of blockers,
three claims, three frontier queries, for one thing.

**The queue's state is not a person's to set.** Every band worth drawing is already derivable:
blockers closed means ready, a claim means running, a question or a verdict means waiting on
someone, accepted means done. A board whose columns are dragged is a board asserting state the
machine already knows.

## Decision

**One object.** A ticket may have children, and `Spec` and `Map` name shapes of a ticket's
body rather than entities of their own. A ticket carries a kind, and the kind says what a run
of it owes — for a decision, the answer written where the map points at it rather than a diff
to verify.

**One relation.** A child blocks its parent: open children keep the parent out of the
frontier, and the parent is finished when its children are. There is no separate
decomposes-into edge, because a blocker already means "this cannot start until that is done"
and a child read from the other end is exactly that.

**A parent runs an integration pass once its children land.** Its own tail runs then — verify
against what the parent promised, review the combined diff. This is where slices that each
passed on their own are caught not fitting together, and it is what gives a parent's tail
anything to mean.

**Triage collapses to a gate and two values.** A ticket is a draft until it is marked
`ready-for-agent` or `ready-for-human`, and only the first is offered to a run. `wontfix` is
closing a ticket with a reason; `needs-info` is a question raised on the ticket. Neither needs
a state of its own, and a draft is not a state the queue derives — it is what a ticket is
before anyone has said what it owes.

**A claim is held, and a claimed ticket is not ready.** A worker holds one with a lease and a
heartbeat; a person holds one with neither, so theirs is shown when it has gone stale and
taken over by hand rather than released by a clock. Either way the ticket is out of the
frontier until the claim ends.

**Rank is the only ordering.** A ticket has a rank that orders it within a band of the queue
and does nothing else. Dragging a card across bands would be a person asserting state the
machine knows, so a drag reorders the frontier and moves nothing between bands.

## Consequences

**The machine owns state; the person owns priority.** That is the whole shape of the queue:
bands come from blockers, claims, and verdicts, and the one thing set by hand is what someone
wants next.

**The five canonical labels become the tracker's own two.** `docs/agents/triage-labels.md` and
`docs/agents/issue-tracker.md` describe GitHub, and they stay as they are until there is a
tracker to describe instead.

**A spec is a ticket, so it is runnable.** A spec marked `ready-for-agent` is a ticket whose
children are its slices, and running it is the integration pass rather than a second,
unrelated thing to do afterwards.

**Revisit if** a decision's answer needs a shape a ticket body cannot hold, or if work ever
wants a third level of children.
