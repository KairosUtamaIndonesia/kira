# Moving Work to a store

Scope: how to get from the run, claim and execution-workspace model to the one in
[ADR 0024](../adr/0024-work-is-a-store-and-skills-do-the-work.md). **Temporary:** delete this file
when the last slice lands, and let the ADR and `CONTEXT.md` carry what stays true.

## The target, in six lines

- A ticket has one stored status (Draft, Ready, Running, In review, Done, Won't do) and an assignee.
  Blocked is shown when a blocker is open.
- **Linking a ticket in the composer starts it.** The agent works it with its kind's skill, sets it
  Running (assigning the chat's person), opens a pull request with the `pr` skill, and sets In review.
  The person reviews and merges on GitHub, then sets Done.
- The agent gets one status tool. It acts only on tickets linked in its own chat, between Ready and
  In review. Publishing, approving and Done or Won't do stay presses.
- Kira keeps no claim, lease, worker, run, worktree, spec branch, diff or review pane, or delivery.
- The board, list, filters, ticket editor, blockers, approval cards (spec, tickets, Outcome,
  Decision), Glossary, chat and skill bundle are unchanged.
- Nothing needs a git repository to start work. A pull request needs a remote and `gh`; without
  them the agent commits on a branch and the person merges with git.

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

That is roughly 10,000 lines out of a much larger codebase. **What replaces it is small**, by
estimate 150 to 250 lines with tests: the desktop reads the stored `status` instead of deriving a
band, and `TicketChange` gains `status` and `assigneeId`, which the server's PATCH already accepts;
a status tool for the agent that only touches tickets linked in its chat; and a change to the text
an attached ticket carries, so the agent knows to work it and move it. No new column, route or
button.

## What stays, and what shrinks

- **Stays:** `workspace/git.ts`, `listing.ts`, `reading.ts`, `watching.ts` (the Workbench's file tree),
  the Workbench's **Workspace** tab (it shows a chat's folder, not an execution workspace), the
  approval cards, `moveToProject`, `fileChat`.
- **Shrinks:** `bandOf` goes (the board reads `status`), `planTicketDrop` (a drop sets a status),
  `TicketReading` in `work.tsx` (no runs, branch or workspace rows), the server's `Ticket` shape
  (`claim`, `runs`, `workspaces`, `gate`, `closure` fields go).

## Data

| Today                                              | After                                   |
| -------------------------------------------------- | --------------------------------------- |
| closed as done                                     | Done                                    |
| closed as won't do                                 | Won't do                                |
| an open claim, or a run with no verdict            | Running; assignee is the claim's holder |
| readiness `draft`                                  | Draft                                   |
| readiness `ready-for-agent` or `ready-for-human`   | Ready                                   |
| runs, transcripts, workspaces, reviews, deliveries | dropped                                 |

The stored `status` column reads `backlog` on every ticket today, so the migration rewrites it from
the rules above rather than trusting it. Dropping run transcripts on the server cannot be undone.
Before the migration runs anywhere but a development database, check that nobody needs what is in
them. Desktop chats that were a run's chat are ordinary local chats already, and keep their words;
give each the attached ticket it was a run of.

## Order

Each slice ends with the tests and typecheck green and can be committed on its own. Tests come
first in every slice.

1. **The agent moves its ticket, beside the old path (the tracer bullet).** Desktop: `status` and
   `assigneeId` in `TicketChange` and its IPC check; a status tool limited to tickets linked in the
   chat; the attached-ticket text tells the agent to work the ticket and move it. Verify in an empty
   folder with no git: link a ticket in the composer, the agent sets it Running, does the work, and
   sets In review; the person sets Done. Then once by hand in a folder with a GitHub remote, where the
   agent also opens the pull request.
2. **The board reads the stored status.** Six lanes become Draft, Ready, Running, In review, Done
   and Won't do, with Blocked shown on the row; drops set the status; remove the run, branch and
   accept or send back parts of the panel.
3. **Remove the desktop run machinery:** `runs.ts`, `worker.ts`, `runChat.ts`, their IPC, and the
   registrations in `main/index.ts` and the preload. Nothing moves out first: a chat with a ticket
   attached is already given its body and checks.
4. **Remove the execution workspace:** the panel, setup dialog, `execution/`, `delivery/`,
   `worktrees.ts`, their IPC and bridge types.
5. **Remove the server layer:** routes, helpers, tables, the two files, the tests, `gate`,
   `closure`, `bandOf`, and the migration above. Last, because nothing then calls it. There is no
   compatibility to keep: the product is pre-release.
6. **Docs sweep:** `DESIGN.md` Work section (lanes, Start agent, refusals), `desktop-conventions.md`,
   the `workCopy.ts` header (with execution workspaces gone, "workspace" means the folder again,
   which reverses that file's rule), `CHANGELOG.md`, and this file.

## Open, with a recommendation

1. **How a ticket learns its pull request merged.** The person sets Done. Nothing polls GitHub.
2. **Terminal, dev-server preview and the diff and review panes.** Drop them with the panel. A
   Changes tab for any chat can come back later on its own merits.
3. **The author-owned question chat** (`startQuestion`, `/question-chat`): a question ticket's
   chat is linked to it through the server. Drop it, and let a question be worked like any
   ticket, unless something needs its author-only rule.
4. **The allowance's "in flight" number** in ADR 0005 becomes chats running at once, or goes.
   Decide before slice 3, since that is where runs stop being counted.
