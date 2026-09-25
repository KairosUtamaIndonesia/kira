---
name: to-tickets
description: Break an approved Foundry spec into vertical-slice tickets and propose them with shape_breakdown_proposal.
---

Break the approved spec into tracer-bullet slices and propose them. The person's Approve on the breakdown card publishes every slice as a child ticket and marks it ready in one step, so each slice must be runnable as written.

## 1. Read

Read the approved spec with `tracker_read_ticket`, the project's words with `tracker_read_glossary` and `tracker_read_decisions`, and the code the spec touches.

## 2. Slice

Each slice cuts a narrow, complete path through the behavior, is verifiable on its own, and is small enough for one fresh run. Sequence wide mechanical changes as expand, migrate and contract, keeping every step green.

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

If approval published the drafts but Foundry refused readiness, do not propose the breakdown again. Read the drafts with `tracker_read_ticket`, correct each draft with `tracker_edit_draft`, then ask the person to use the renderer's Mark ready action to retry readiness on those already-published drafts.

After approval the person starts work with Run what's ready. Each run is its own chat with its own brief.
