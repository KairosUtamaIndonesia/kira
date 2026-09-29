---
name: implement
description: Implement linked Kira tickets for an approved spec, or one standalone ticket, through its acceptance criteria.
---

Implement one approved spec at a time, or one linked standalone ticket. Work only on tickets linked in this chat. Keep every ticket for a spec on one branch so its commits can be reviewed together.

## Steps

1. Read the approved spec and linked tickets. Understand their acceptance criteria and blockers. If the linked tickets do not cover the spec, ask the person to link the missing tickets before starting. For a standalone ticket, use that ticket's criteria.

2. Read the repository's instructions and inspect the worktree and `main` branch. For a spec, choose `spec/<spec-id>-<slug>` and ask the person to confirm creating or continuing it from `main` before changing branches or editing code. Wait for explicit approval. For a standalone ticket, follow the repository's existing branch workflow. Preserve existing work; if changing branches would carry or overwrite it, use an isolated worktree when supported or ask how to proceed.

3. After approval, use the repository's version-control workflow to create or check out the spec branch from `main`. Verify its base before editing. Work tickets in dependency order and commit each ticket's changes on that branch; do not create a branch per ticket.

4. Set each linked ticket to Running through Kira's ticket action before working on it. Implement its criteria with test-first slices at the highest existing seam; run focused tests and typechecks as you work. Commit each ticket's work on the spec branch. Keep unfinished tickets Running. Set a ticket back to Running before changing work that is already in Needs review. Change only linked tickets, and never mark one Done.

5. When all tickets in the spec are implemented, run the full relevant checks and review the complete branch against the spec. Keep tickets Running while fixing findings; commit fixes on the same branch and rerun affected checks. If this run covers only part of a spec, report the remaining tickets and do not present the spec as complete.

6. If the repository has a configured remote, publish the branch and open one ready-for-review PR for the spec, or for the standalone ticket. Link the spec and tickets. After the PR opens, set the linked tickets to Needs review. If there is no remote or publishing fails, leave tickets Running and report why. Do not merge or mark tickets Done; a person reviews and merges, then marks them Done.
