# A subagent is a child agent of one chat

Date: 2026-10-04

Amends ADR 0005 (a chat's subagents spend the same allowance and count under the same cap) and ADR 0024 (a write-capable subagent works in a checkout of its own).

## Context

CONTEXT.md already carries **Subagent** — "a separate agent Kira delegates a bounded piece of work from one chat" — and the desktop already stores one: a child is a thread row with `subagent_json` and `parent_thread_id`, and `SubagentRecord` carries a `role`, a `context`, a `status`, a `response` and an `error` (`apps/desktop/src/main/db/threads.ts`). Nothing spawns, drives or shows a child yet: a whole-repo search for `subagent` reaches only that file and its test.

Two references settle the shape. `@gotgenes/pi-subagents` is an in-process core: child `AgentSession`s with their own tools, model and working directory, run in the foreground or the background, steerable, resumable, and able to ask the parent back, with a typed service and lifecycle events on top (`docs/internal/research/pi-subagents-for-kira.md`). OpenChamber, a client over OpenCode 2, treats a child as a first-class session, keeps the parent *marked running* while children work, rolls up their subtree cost, and delivers a child's report to the parent as one message.

What those leave open is Kira's own: who owns a child, what a child may do, where it works, what it costs, and where it is seen.

## Decision

**A subagent is a child agent of one chat.** Kira delegates it from a chat and the person watches it there. It is not a second way to build a ticket — work on a ticket stays the chat's own (ADR 0024) — and it is not a run: there is no claim, lease or verdict.

**A running child keeps its chat retained, and nothing outlives the app.** `openChats` disposes an idle chat the moment it is left and not writing. A child that is running counts as its chat *writing*, so switching away does not stop it and the same rule that stops a being-written-in chat from being archived or deleted protects it too. There is no app-level registry: OpenChamber needs one only because OpenCode's server owns its sessions, and Kira has no such split.

**A child starts from a clean brief.** It is given its task prompt, not the chat's transcript; the private window is the reason to separate it. The schema's `context` is written `'task'`, and `'parent'` stays recognised but unbuilt.

**A child can be steered, resumed, and can ask back.** The full ladder: a spawn reports, a running child can be aborted or steered, a settled one resumed, and a child that needs information the chat does not hold ends its turn with a question the chat answers. Because a child lives only as long as its chat, resume is a *while-the-chat-lives* ability — the reference's own `session-released` and `no-session` refusals are the honest end of it.

**A child has a role, and the roles are a closed set.** A role fixes the tools the child may use, the model it runs on, and whether it runs in the foreground. Kira ships at least two: a general role with the chat's tools, and a read-only role for investigation, because a write-capable investigator is a safety problem — the reference splits `Explore` and `Plan` from `general-purpose` for the same reason. This widens the schema's `role` from the single value `'general'` to a closed union.

**A child is a leaf.** Only a chat delegates; a child does not delegate its own. Both references allow a sub-tree, and a leaf keeps the cap countable and the Workbench one level deep.

**Where a child works follows from its role.** A read-only role shares the chat's folder; a role that may write works in a checkout of its own, so two write-capable children — or a child and its chat — cannot clobber one another. This is the collision ADR 0024 said to revisit, arriving inside one chat rather than between two tickets, and it is reached by the rule ADR 0012 wrote for runs.

**A chat's subagents spend the same allowance under a per-chat cap.** Children draw on the one pool through the existing ledger, so no second budget is invented, and they count against the allowance's cap on chats running at once — the fan-out ADR 0005 predicted when it wrote that "a session starts driving a fan-out of subagents that the run cap does not count".

**A child is a thread, and its outcome is a message.** The child's transcript is stored as a chat's is — a thread with its entries in the ThreadStore — and its terminal `response`, `error` and `status` sit on `subagent_json` as the outcome the chat reads. Its entries stay out of the parent's `ChatTranscript`.

**Activity and outcome take different channels.** A child's live activity streams to the Workbench alone — a compact row above the Composer and an Agents tab for the selected child's read-only transcript — while its terminal outcome lands as one message in the parent chat, where the person sees it and Kira reads it.

## Considered options

- **App-level ownership of children.** OpenChamber's shape, and it makes a child independent of whether its chat is open. Rejected: it buys independence Kira's jobs do not need, adds a second lifetime owner beside `openChats`, and Kira has no server to host it in.
- **Inheriting the chat's context.** It reads as continuity, and it defeats the isolation that is the point of a separate window.
- **One generic child.** It matches the schema as it stands (`role: 'general'`) and cannot express a read-only investigator, which the investigation job needs.
- **Caller-composed tool sets.** The reference keeps an agent's `tools:` as the only thing that admits a tool and names a global run-mode default a non-goal; a closed role set is that discipline rather than a per-call menu.
- **Nesting.** Both references allow it; it makes the cap a depth question and the Workbench a recursion, and no job needs it.
- **A separate subagent budget.** Nobody asked for one, and a second budget is a second thing to keep fair when the one allowance already exists.

## Consequences

- **The schema moves.** `role` becomes a union rather than the single value `'general'`, `context` is written `'task'`, and a child thread's entries become storable — migrations in `db/threads.ts` beside the existing `subagent_json` column.
- **ADR 0024's isolation stance is narrowed for subagents, not reversed for tickets.** Two running tickets still share one checkout; a write-capable child does not.
- **ADR 0005's revisit condition is answered.** Its cap now counts a chat's fan-out, and both its "runs in flight" wording and CONTEXT.md's "chats running at once" already point that way.
- **Resume is bounded twice** — by the chat's retention and, for a write-capable role, by its workspace's life.
- **A child is readable but not the chat's.** A person opens the Agents tab and reads it; they do not type into it, and a child that needs a person escalates through Kira's questionnaire surface rather than a second composer.

## Sources

- The reference at `69e2b81`: `packages/pi-subagents/src/service/service.ts` (`SubagentsService`), `src/tools/agent-tool.ts` (the `subagent` tool), `src/config/default-agents.ts`, `README.md`.
- OpenChamber's handling of OpenCode children: `packages/ui/src/lib/opencode/subagent-run.ts`, `.../chat/lib/runningSubagentRuns.ts`, `.../chat/work-status/WorkStatusSubagentsSection.tsx`, `.../sync/child-session-discovery.ts`.
- Kira: `apps/desktop/src/main/db/threads.ts` (`SubagentRecord`), `apps/desktop/src/main/pi/openChats.ts`, `apps/desktop/src/main/pi/agent.ts`; `docs/internal/research/pi-subagents-for-kira.md`; CONTEXT.md; ADR 0005, ADR 0012, ADR 0024.
