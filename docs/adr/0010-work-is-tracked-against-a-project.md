# Work is tracked against a project, not a folder

Date: 2026-09-21

## Context

The desktop files each chat under a **project**, which is a folder someone added
(`apps/desktop/src/main/db/threads.ts`). Identity is the folder path, so choosing the same
folder twice is one project however it was spelled, and a chat with no project is filed
nowhere. That is the right shape for what it does today: a chat runs in a directory, and
grouping chats by directory groups them by what they are about.

Kira is to become a software factory — agents taking work and running it — and that adds
tickets, blockers and runs to the same model. Folder identity breaks under all three.

**A factory runs agents at the same time on one body of code, and each needs its own
checkout.** One repository becomes many folders. If a ticket belongs to a folder, the queue
splits the moment the factory does anything useful: two agents on one repository are two
ticket homes, and neither of them is the queue.

**Neither side of the mapping holds.** A folder need not be a repository at all — a scratch
directory, a folder of notes — and a body of work need not be one repository. Under folder
identity neither case has anywhere to go.

**A folder is local to one machine.** Work that exists only on the machine that has the
folder open cannot be seen by a second person, and cannot be dispatched to a worker that has
no checkout of its own.

The first attempt at this settled on keying work by the repository's git remote, which fixes
the first problem and not the other two: it answers "which checkout is this" by making the
answer part of identity, when the question only ever needed answering, not storing.

## Decision

**Work is tracked against a project, held by the server.** A project is a shared body of
work with one queue of tickets. It is not a place on disk, and it is what people and agents
mean by "what we are building" — Kira is one.

**Today's `Project` is renamed a workspace:** a folder on someone's machine that a run
happens in. There are as many workspaces per project as there are agents working at once,
and nothing about a workspace is shared.

**A ticket belongs to a project and names no repository.** A run is one agent's attempt at a
ticket, in one workspace. Where a ticket's code lives is a property of the workspace the run
chose.

**A folder joins a project when it is opened.** Opening a folder asks which project it is for
— an existing one or a new one — and the answer is remembered with the folder. Guessing from
the git remote was the alternative and it will not do: a folder may have no remote, or two, or
a fork's. This link is the one place the shared half and the local half meet, and it is what
makes a project's tickets runnable on a machine.

**A repository is not a Kira concept, deliberately.** A workspace knows its own
repositories, from the folders in it and from the git remote that says which body of code
they are a checkout of. That is enough while every workspace is one a person already had.

**A run is a proposal, never a fact.** Testing green and a review passing are evidence a
person reads, not authority to land. This is why the queue has a band of its own for work
waiting on a person, and why it is the largest of them.

## Consequences

**The git remote is demoted, not removed.** It stops being what work is keyed to and becomes
how a workspace recognises that two folders are the same body of code — for deduplicating
the list a person sees, and later for provisioning. No ticket, and no queue, depends on it.

**A project carries no repositories yet, and this is a known limit.** A workspace is
somewhere a run happens because a person already had that folder, and since only that person
starts their own runs (ADR 0012), every run has one. The first time a run must make its own
workspace — the human's folder is busy, or the run happens where there is no checkout — a
project needs a list of repositories to build one from. That is a field on the project, not a
level above it, and it is not built until a run needs it.

**`Issue` is retired as a second word for the same object.** Work that has not been triaged
yet is a ticket in that state, not a different noun. The tracker's words and the skills' are
now one set: `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md` describe the
same object the glossary calls a ticket. What those skills call labels become a ticket's kind,
the marking that makes it ready, and a state the queue derives (ADR 0017) — and the two docs
keep describing GitHub until there is a tracker to describe instead.

**The rename landed with the ticket tables.** `Project` now means the shared body of work on
the server, and the folder it used to name is a **Workspace** in
`apps/desktop/src/main/db/threads.ts` and in the desktop's side nav, carrying the project it
works. Folders added before the change came through it with their chats and their
observations, so nobody re-added a folder or re-filed a chat (GH #65).

**Revisit if** a project genuinely spans several bodies of work that want separate queues
(then a project is not the top), or if a ticket needs to name its code before a run picks a
workspace (then repositories come back as something a project holds).
