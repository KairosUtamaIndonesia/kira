# Moving Work to a store

Scope: how to get from the run, claim and execution-workspace model to the one in
[ADR 0024](../adr/0024-work-is-a-store-and-skills-do-the-work.md). **Temporary:** delete this file
when the last slice lands, and let the ADR and `CONTEXT.md` carry what stays true.

## The target, in six lines

- A ticket is draft, ready, running or closed. Blocked is derived from open blockers.
- **Work on this** opens a chat in the project's folder with the ticket attached and its kind's
  skill, and marks the ticket running (who, since when). Only a person starts it.
- **Resolve…** (Mark done, Won't do) is the only way a ticket closes. Nothing merges on accept.
- Kira keeps no claim, lease, worker, run, branch, worktree, remote or pull request.
- The board, list, filters, ticket editor, blockers, approval cards (spec, tickets, Outcome,
  Decision), Glossary, chat and skill bundle are unchanged.
- Nothing needs a git repository or a remote to start work.

## What goes

Line counts are from `wc -l` on 2026-09-30, so they include code that only moves or shrinks. Read
them as size, not as a savings promise.

| Area             | What                                                                                                                                                                                                                                                               | Lines (about) |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Server routes    | deliveries (2 routes), workspaces and review (6), claim (4), runs and transcript (7), all in `tickets.ts`                                                                                                                                                          | 800           |
| Server helpers   | claims, leases, staleness, run and transcript readers, workspace, review and delivery readers, branch naming, `bandOf` shrinks                                                                                                                                     | 390           |
| Server files     | `workers.ts`, `workers.test.ts`, `review.test.ts`                                                                                                                                                                                                                  | 810           |
| Server schema    | tables `claim`, `worker`, `run`, `transcript`, `executionWorkspace`, `delivery`, `reviewComment`, `reviewFeedback`, plus a migration                                                                                                                               | 230           |
| Server tests     | about 35 of the 80 cases in `tickets.test.ts` name claim, run, lease, worker or transcript                                                                                                                                                                         | 900           |
| Desktop main     | `runs.ts`, `worker.ts`, `ipc/run.ts`, `ipc/worker.ts`, `ipc/execution.ts`, `ipc/delivery.ts`, `execution/`, `delivery/`, `workspace/worktrees.ts`, `pi/runChat.ts`, and their tests                                                                                | 5,000         |
| Desktop renderer | `executionWorkspace.tsx`, `.ts` and test, `workspaceSetup.tsx`, `workTrace.tsx`; in `work.tsx` `RunReading`, `RunHistory`, `BranchLine`, `DropActionBar`                                                                                                           | 2,600         |
| Desktop bridge   | types `TicketRun`, `TicketClaim`, `WorkerStanding`, `ExecutionWorkspace`, `ExecutionReview`, `ReviewComment`, `ReviewFeedback`, `DeliveryAudit`, `DeliveryPath`; channels `WORKER`, `RUN`, `EXECUTION`, `DELIVERY`, and the claim and workspace parts of `TRACKER` | 300           |
| Wording          | `workCopy.ts` groups `drop`, `setup`, `branch`, `sessions`, `holding`, `workspace`                                                                                                                                                                                 | 150           |

That is roughly 10,000 lines out of a much larger codebase. **What replaces it is small**, about
400 to 600 lines by estimate: a start and stop route and a `startedAt` column on the server, a
`startWork` action in the desktop that generalises `startQuestion` and reuses the brief that
`runChat.ts` builds, and a Work on this button.

## What stays, and what shrinks

- **Stays:** `workspace/git.ts`, `listing.ts`, `reading.ts`, `watching.ts` (the Workbench's file tree),
  the Workbench's **Workspace** tab (it shows a chat's folder, not an execution workspace), the
  approval cards, `moveToProject`, `fileChat`.
- **Shrinks:** `bandOf` (six bands become five statuses), `planTicketDrop` (three drops: Work on
  this, stop, Resolve…), `TicketReading` in `work.tsx` (no runs, branch or workspace rows), the
  server's `Ticket` shape (`claim`, `runs`, `workspaces` fields go).

## Data

| Today                                              | After                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| closed, done or won't do                           | unchanged                                                                    |
| an open claim, or a run with no verdict            | **running**; assignee is the claim's holder; `startedAt` is the claim's time |
| readiness `draft`                                  | draft                                                                        |
| readiness `ready-for-agent` or `ready-for-human`   | ready                                                                        |
| runs, transcripts, workspaces, reviews, deliveries | dropped                                                                      |

Dropping run transcripts on the server cannot be undone. Before the migration runs anywhere but a
development database, check that nobody needs what is in them. Desktop chats that were a run's
chat are ordinary local chats already, and keep their words; give each the attached ticket it
was a run of.

## Order

Each slice ends with the tests and typecheck green and can be committed on its own. Tests come
first in every slice.

1. **Running, beside the old path (the tracer bullet).** Server: `startedAt`, start and stop
   routes, `running` derived from them. Desktop: `startWork` and a Work on this button. Verify on a
   new project in an empty folder with no git: spec, tickets, Work on this, the chat opens with
   the ticket and its skill, the ticket reads running, Mark done closes it.
2. **The board reads five statuses.** Remove the Needs review lane; simplify `planTicketDrop`;
   remove the run, branch and accept or send back parts of the panel.
3. **Remove the desktop run machinery:** `runs.ts`, `worker.ts`, their IPC, `runChat.ts` (after
   its brief moves into `startWork`), and the registrations in `main/index.ts` and the preload.
4. **Remove the execution workspace:** the panel, setup dialog, `execution/`, `delivery/`,
   `worktrees.ts`, their IPC and bridge types.
5. **Remove the server layer:** routes, helpers, tables, the two files, the tests, and the
   migration above. Last, because nothing then calls it. There is no compatibility to keep: the
   product is pre-release.
6. **Docs sweep:** `DESIGN.md` Work section (lanes, Start agent, refusals), `desktop-conventions.md`,
   the `workCopy.ts` header (with execution workspaces gone, "workspace" means the folder again,
   which reverses that file's rule), `CHANGELOG.md`, and this file.

## Open, with a recommendation

1. **Terminal, dev-server preview and the diff and review panes.** Drop them with the panel. A
   Changes tab for any chat can come back later on its own merits.
2. **The `gate` column.** Keep the column and collapse its values to `draft` and `ready`; rename
   it later so the migration runs once.
3. **Who is running a ticket.** `assigneeId` already exists on the ticket, so reuse it and add
   `startedAt`, rather than adding a second person column.
4. **The author-owned question chat** (`startQuestion`, `/question-chat`) becomes the general
   Work on this, and its route goes.
5. **The allowance's "in flight" number** in ADR 0005 becomes chats running at once, or goes.
   Decide before slice 3, since that is where runs stop being counted.
