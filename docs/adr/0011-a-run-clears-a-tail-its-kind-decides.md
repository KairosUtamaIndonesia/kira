# A run clears a tail its ticket's kind decides

Date: 2026-09-21

Amended by ADR 0021: `decision` becomes `question`, and research, spec and map are added.

## Context

ADR 0010 settles that a run ends as a proposal a person accepts, and that nothing lands on
its own. It leaves the question it did not answer: a proposal of _what quality_ is worth a
person's attention? Two answers are in use elsewhere and both are wrong here.

**One tail for everything.** `implement` runs `/code-review` after every piece of work,
whether it added a feature or answered a throwaway design question through `/prototype`. So
the prototype owes a review it does not need, and a wide refactor gets the same treatment as
a one-line fix.

**A depth dial someone has to keep turning.** `jsmastery-pro/skills` sets a depth per project
(Prototype, Alpha, Beta, GA) with a per-feature override. That is two sources of truth for
one question, and the answer is only right while a person keeps it right.

What the repo already shows is that the answer varies by _kind_ of work: `/to-tickets`
singles out the wide refactor as the case that is not a tracer bullet, and `/prototype`
produces something that exists to answer a question and is kept only as a primary source.
Kind is known when a ticket is written, which is exactly when its tail should be known.

## Decision

**The ticket's kind decides the tail: the checks its run must clear before its output counts
as a proposal.** Kind is set at authoring time and is not a dial — there is nothing to keep
turning.

| Kind      | Tail                                                         |
| --------- | ------------------------------------------------------------ |
| prototype | self-check; the run lands on its own branch                  |
| bug       | a regression test that failed before the fix, verify, review |
| feature   | verify, review                                               |
| refactor  | verify, review, document                                     |
| decision  | the answer is written where the map points at it             |

**What a ticket owes follows from what it delivers, not how it is resolved.** A decision
ticket in a `/wayfinder` map is reached by reading, by building a throwaway, or by
interviewing someone, and `prototype` means one thing in both vocabularies. What is owed does
not change with the route taken, so the route is what the ticket's body says rather than a
field. The ones needing a person are marked `ready-for-human` (ADR 0017), which is where "this
one is a conversation" already lives.

- **verify** — the change is exercised for real against the ticket's acceptance criteria,
  rather than read and reasoned about. **The run does this and attaches what it saw**; a run
  that could not verify says so on the ticket and lands in the band waiting on a person,
  rather than claiming a pass it did not earn.
- **review** — two axes (Standards, Spec), on a different model from the one that wrote the
  change. Kira's pool makes a different provider the ordinary case, not a special one.
- **document** — the prose the change owes: PR body, and a changelog entry when it is
  user-facing.

**The tail is a floor, not a ceiling.** A person may ask for more on a ticket, and the ticket
records that they did; the tail never asks for less than its kind owes.

**A check that fails does not fail the run.** The run iterates while it can, and when it
cannot, it stops with the failure recorded — which is a proposal to a person, not a dead
ticket.

## Consequences

**Kind is a field on the ticket, not a label someone applies afterwards.** The queue can
therefore show what a run will owe before it starts, and the dispatcher can refuse a ticket
whose tail the chosen workspace cannot clear.

**`verify` is the hard one, and it is mostly resolved elsewhere.** Exercising a change for
real is straightforward for a server route and was awkward for the desktop app:
`docs/internal/frontend-debugging.md` drives the dev app over CDP on port 1987, which wants a
machine with a display. With runs happening on someone's own desktop (ADR 0012) that machine
_is_ the display. What survives is smaller: a workspace can clear a `verify` only if it can
start the app, and the person pressing Run is told when it cannot — before the run starts,
rather than through a run that quietly checked nothing.

**Revisit if** a kind's tail turns out to want fewer or more checks once runs have actually
cleared it, or if a wide refactor stops being expressible as a refactor — `/to-tickets`
already treats it as its own case with expand–contract sequencing, and it is the candidate for
a sixth kind if the tail proves too small.
