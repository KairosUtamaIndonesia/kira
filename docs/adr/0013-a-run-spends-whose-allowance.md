# A run spends the allowance of the person whose work it is

Date: 2026-09-21

## Context

ADR 0012 makes the desktop a worker, so a run is a request Kira sends — one a person starts
by pressing Run, and one that carries on after they stop watching it. Because a run is a
steerable chat, watching is a choice its driver makes rather than a requirement of the
machinery. ADR 0005 counts usage per user per
calendar month, refuses pre-flight any request that does not fit, and records every one in a
ledger of raw facts. Neither says whose allowance a run comes out of.

**Charging the project is tidier and bounds less.** A project budget spreads the cost over a
number that belongs to nobody in particular, so the first sign of a runaway run is a shared
figure moving — and the larger that figure is, the further a runaway gets before anything
stops it. It also creates a second thing to run out, with its own overrides, its own defaults
and its own refusals.

**Charging the person who asked is harsher and bounds tightly.** They pay for the work they
delegated _and_ for the tokens needed to review it, so authoring twenty tickets can spend a
month before they have read a word. What makes that acceptable is that ADR 0005 already
defines a per-user override: hitting the ceiling is an administration task, not a dead end.

The tight bound is the one worth having. A run that stops is recoverable in a minute; a run
that does not stop is a night's worth of a shared pool.

## Decision

**A run spends the allowance of the person the ticket is for** — its author. There is no
assignee apart from that, because only its payer starts a run (ADR 0012): a ticket belongs to
whoever asked for it, and a ticket Kira drafted belongs to whoever asked her, which is where
its attribution already points.

**The ceiling still stops a run.** Runs are not exempt from ADR 0005's pre-flight check. A run
that does not fit is refused before it starts, recorded with its reason, costing nothing.
There is no unbounded mode.

**Every request is recorded against the project whose work it was.** One nullable column on
the usage ledger, which stays a ledger of raw facts rather than becoming a set of counters.
What the factory costs is then a query over rows that already exist, in the same way ADR 0005
says a rate card would be.

**A run cannot be started by someone who cannot pay for it.** This joins the filter ADR 0012
already puts on the frontier — only work whose tail this workspace can clear — with a second:
only work whose payer can afford the start. Affordability is checked when Run is pressed
rather than during the run, so no workspace is ever given work that cannot begin.

**The allowance row carries a second number: how many runs one person may have in flight.**
A monthly ceiling cannot see parallel runs, and ADR 0005 said so before there were any. So
the row that already holds a token override holds this beside it — a default in config, a
per-user override, and nobody unbounded — and the cap is enforced where the affordability
check is: when Run is pressed. What it bounds has changed, though. It was owed for the fan-out
an unattended queue would create; runs are started by a person now, so it bounds how many they
set going themselves — a limit they choose rather than a defence they need. A ticket whose
payer is already at their cap waits, which is not a refusal: nothing was turned away, it has
not started yet.

## Consequences

**ADR 0005's deferred second guard has found its trigger.** That ADR said a monthly ceiling
cannot stop one person with eight parallel chats from taking the afternoon's capacity, that a
per-user cap on simultaneous turns belongs beside it, and that the cap waits because no
legitimate fan-out existed. `implement-spec` was already writing down how to drive implementer
subagents in the background for maximum concurrency, and the factory runs several tickets at
once, so the fan-out it was waiting for is here — a ceiling cannot see six parallel runs any
more than it could see eight chats. What ADR 0012 changes is who fans out: a person pressing
Run rather than a queue dispatching on its own, so the cap is the number bounding one person's
parallel runs rather than the brake on an unattended one.

**The cap counts runs, and a person's chats are still bounded only by the ceiling.** This is
the asymmetry worth naming: what the cap answers is the fan-out automation creates, and
turning it into a cap on every kind of turn would stop a person chatting while their runs go,
which is a worse trade than the one ADR 0005 accepted. So eight parallel chats remain visible
to the monthly ceiling and nothing else, exactly as that ADR left them. If parallel chats turn
out to matter, the number counts all turns rather than runs, and nothing else about it changes.

**One run can consume a person's remaining month, and that is the accepted bound.** A single
runaway run is stopped by the ceiling like any other request, and when it is, the payer is at
zero until an administrator raises their override. A per-run ceiling would keep some of the
month back, at the cost of machinery for a case the boundary already catches and an override
that gives the time back more cheaply.

**Authoring work can spend a person's month before they have read anything.** The person who
writes twenty tickets pays for all twenty runs, including the tokens to review what they
produce. This is the price of the tight bound, and the override is the intended answer to it
rather than a workaround.

**A steering message spends the payer's allowance, and the payer is the only one who types
it.** The seat is not handed over (ADR 0012), so the hand on the keyboard and the allowance
being spent are the same person — which is what makes this simple, rather than the reason for
a rule about who may steer someone else's run.

**A project's cost is readable and is not a budget.** Project attribution answers "what did
this feature cost" and "what is the factory spending" without creating a second thing to run
out. A project budget, if ever wanted, is a number compared against these same rows.

**Revisit if** a project budget is wanted once projects have been observed spending, or if
topping a person up becomes frequent enough that the ceiling is plainly set wrong.
