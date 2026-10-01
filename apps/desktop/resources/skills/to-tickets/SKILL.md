---
name: to-tickets
description: Break an approved Kira spec into vertical-slice tickets and propose them with shape_breakdown_proposal.
---

Break the approved spec into tracer-bullet slices and propose them. The person's Approve on the breakdown card publishes every slice as a child ticket and marks it ready in one step, so each slice must be runnable as written.

## 1. Read

Read the approved spec with `tracker_read_ticket`, the project's words with `tracker_read_glossary` and `tracker_read_decisions`, and the code the spec touches.

## 2. Slice

Each slice cuts a narrow, complete path through the behavior, is verifiable on its own, and is small enough for one fresh chat. Sequence wide mechanical changes as expand, migrate and contract, keeping every step green.

For each slice give:

- **id**: a short id the other slices can name.
- **kind**: one of `prototype`, `bug`, `feature`, `refactor`, `question`, `research`, `spec` or `map`.
- **title**: the one user-visible behavior it delivers.
- **body**: what to build and the tests that prove it, rather than a layer-by-layer work list.
- **criteria**: completion criteria, each a concrete check a run can prove true or false.
- **dependsOn**: only ids of sibling slices in this proposal that it genuinely waits on. The approved spec gate is attached automatically.

Done when every spec story is covered by a slice, every slice has criteria, and the dependencies form no circle.

## 3. Propose

Call `shape_breakdown_proposal` with all the slices. The approval card appears on its own. End your turn and wait for the person. When they ask for changes, revise and propose again; the new proposal replaces the old one.

If readiness was refused, the approved tickets remain Draft. Tell the person which tickets need clearer completion criteria so they can edit them in Work and retry readiness from the breakdown card. Do not propose or publish the breakdown again.

After approval, the person can request work on tickets in the current project, including asking for the first actionable ticket. Attachments are optional context. Kira uses the skill named by each ticket's kind and sets Running when work begins, which records the chat link automatically; there is no separate start action.
