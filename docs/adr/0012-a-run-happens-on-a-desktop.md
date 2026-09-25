# A run happens on someone's desktop, not a server

Date: 2026-09-21

## Context

ADR 0010 puts the queue on the server and ADR 0011 says what a run owes. Neither says
where a run executes, and the answer is not free: Foundry has no remote sandboxes, so there
is no server-side place to give an agent a checkout, a test run, and a real app to drive.

What the desktop already has is most of a runner. The agent loop is local
(`apps/desktop/src/main/pi/`), the model credentials come through the server without ever
being held here, several conversations are open at once under `openChats`, and a chat that
is filed under no project already gets a folder of its own — `newSpace()` in
`apps/desktop/src/main/index.ts` makes one under `userData/space/<uuid>`, as a convention
rather than a sandbox (ADR 0001 gives Kira a terminal's reach).

What it does not have is isolation between two runs on the same project: a chat filed under
a project works in that project's folder, because there is only ever one chat working at a
time by assumption. Parallel runs break that assumption with nothing to catch them.

## Decision

**The desktop app is where a run happens, because it is the only place a run can happen.** A
run is claimed and reported by a **worker**: a desktop app that is online, holds workspaces,
and holds a claim for as long as it runs one.

**The server owns the queue; a worker owns execution.** The server decides what is ready. A
worker never decides what work exists, and it does not take work on its own either: **a run
starts when the person the ticket is for starts it**, on their own machine, and the claim is
held by theirs. Work its payer is away from — no checkout of the project, a laptop that is
shut, a desk they have left — waits rather than being handed to somebody else. Delegation is
deliberately not built, and the reason is the same as the one for the whole shape: a run
spends its payer's allowance, so the hand that starts it should be theirs.

**The claim is a lease with a heartbeat**, which is how a worker that stops answering is told
apart from one that is working. A person holds a claim too, when they work a ticket by hand,
and theirs has neither: it is shown when it has gone stale and taken over by hand, so nobody's
work is reassigned by a clock. Either way a claimed ticket is ready for nobody else, and
staleness is displayed rather than acted on.

**A worker declares what it can do before it is given anything.** Which project, which
workspace, whether that workspace can start the app for `verify` (ADR 0011), and how many
runs at once. Those declarations filter the frontier, so pressing Run on a ticket whose tail
this workspace cannot clear is refused before the run starts rather than discovered by it.

**One run, one worktree.** A run gets a checkout of its own, made from the project's folder,
so two runs on one project cannot write over each other. This is what `implement-spec`
already asks for — "each implementer subagent should work in its own worktree, on its own
branch" — and it becomes the rule for every run rather than the habit of one skill.

**An interrupted run is kept, and its ticket goes back to the queue.** A laptop that sleeps
or closes mid-run does not lose the ticket and does not summon a person: the claim expires,
the run is recorded as interrupted with its branch, and the next worker to take the ticket is
told the branch is there. Resuming is what the next run does by default, not a decision
anyone has to make.

**A run is a chat, and it is steerable while it runs.** The desktop already answers a chat one
thing at a time while still letting words in — `QueuedLine`'s two lanes are the whole
mechanism (`apps/desktop/src/preload/bridge.ts`), `next` read at the agent's next step and
`later` once the turn in flight has finished, with `stop` and `takeQueuedBack` beside them. So
a run is not a job submitted and awaited: it is a session that can be watched, steered, and
stopped, because that is what the chat already is. **Its transcript belongs to the project,
not to its driver** — it crosses to the server beside the record of its state, branch, diff,
and checks, so anyone signed in to the project can read what was said and what was tried. And
**only the payer starts a run and only the payer steers it**: the seat is not handed over, so
a driver who has gone is a run that waits rather than one somebody else takes up.

**Accepting a proposal is a verdict, not a merge.** The person the ticket is for reads the
diff, the checks, and the review, and accepts or sends it back. Accepting closes the ticket
and records the verdict; the merge happens in their own git client, in the workspace the run
happened in. Foundry never rewrites a history, settles a conflict, or lands a branch for
someone — so a ticket can be accepted while its branch is unmerged, which is a visible
process failure rather than one Foundry prevents.

## Consequences

**`verify` mostly stops being a problem, which closes ADR 0011's open consequence.** The
awkward case there was exercising the desktop app on a machine with no display. Runs on
someone's own desktop _are_ on the display, and `docs/internal/frontend-debugging.md` already
drives the app over CDP on port 1987 from that machine. What survives is a smaller version of
the same constraint: a workspace can only clear a `verify` if it can start the app, and it
has to say so before it is given the ticket.

**The queue has to show which worker holds a run, and whether it is still there.** "Running"
is only true while a worker says so; a run whose worker has gone quiet is interrupted, not
running. Without that the queue lies, and the lie is invisible — a stalled ticket looks like
a busy one.

**Concurrency is bounded by the machine, not by the queue.** A worker takes as many runs as
it was told it could hold, and no more. Foundry's own concurrency limit is therefore whatever
the laptops in the room will bear, which is a real limit to write down rather than a number to
discover under load.

**A run's transcript is project data, and the desktop's local chat history is now the
exception rather than the rule.** A person's own chats stay in the desktop's SQLite because
they are one person's; a run's transcript goes to the server because it belongs to a ticket
other people may read (ADR 0009). The driver still keeps it where they work — a run they are
driving shows as a row in their chat list for as long as something holds its claim, and the
row goes when the run ends, leaving the transcript on the ticket.

**Revisit if** a remote sandbox ever exists (then a server-side worker is a second kind of
worker, and the desktop stops being the only one), if workers turn out to need to talk to each
other (they should not; the queue is the only channel), or if a project acquires a second
person who needs to start or steer runs — delegation and a handed-over seat were declined for
a factory with one person in it, and they are the first things a second person wants.
