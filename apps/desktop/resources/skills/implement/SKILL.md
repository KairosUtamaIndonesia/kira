---
name: implement
description: Implement requested Kira tickets in the current project for an approved spec, or one standalone ticket, through their acceptance criteria.
---

Implement the work the person requests in the current project: one approved spec, a requested subset of its tickets, or one standalone ticket. Attachments provide context; a ticket need not be attached before working it. Keep every ticket for a spec on one branch so its commits can be reviewed together.

## Steps

1. Read the approved spec and its tickets through the tracker. Understand their acceptance criteria and blockers. For a request to work on the first actionable ticket, read `tracker_queue` and select one ready, unblocked ticket; work only that ticket. For a standalone ticket, use that ticket's criteria.

2. Read the repository's instructions and inspect the worktree and `main` branch. For a spec, choose `spec/<spec-id>-<slug>` and ask the person to confirm creating or continuing it from `main` before changing branches or editing code. Wait for explicit approval. For a standalone ticket, follow the repository's existing branch workflow. Preserve existing work; if changing branches would carry or overwrite it, use an isolated worktree when supported or ask how to proceed.

3. After approval, use the repository's version-control workflow to create or check out the spec branch from `main`. Verify its base before editing. Work tickets in dependency order and commit each ticket's changes on that branch; do not create a branch per ticket.

4. Set each requested ticket to Running through Kira's ticket action before working on it. Kira records the chat link and assigns the person automatically. Implement its criteria with test-first slices at the highest existing seam; run focused tests and typechecks as you work. Commit each ticket's work on the spec branch. Keep unfinished tickets Running. Set a ticket back to Running before changing work that is already in Needs review. Stay within the requested work in the current project, and never mark a ticket Done.

5. When a requested ticket meets its own acceptance criteria and its focused checks pass, move it to Needs review as described in step 6, even when sibling tickets in the spec remain unfinished. Keep unfinished tickets Running. When all tickets in the spec are implemented, run the full relevant checks and review the complete branch against the spec before review. Keep affected tickets Running while fixing findings; commit fixes on the same branch and rerun affected checks. Never mark a ticket Done or Won’t do; a person does that after review.

6. For each completed ticket, if the checkout has a remote, publish the branch and open or update a ready-for-review PR for the work, linking the ticket and its spec. Attach the PR's HTTPS URL to the completed ticket and set it to Needs review. If there is no remote, commit the branch and set the completed ticket to Needs review without a PR link. If publishing or opening/updating the PR fails, leave that ticket Running and report why. When all tickets in the spec are implemented, the PR must cover the complete branch and link the spec and all tickets. If PR review asks for changes, set affected tickets back to Running before fixing them, then to Needs review after the fixes are committed, pushed to the PR, and checks pass. A person reviews and merges, then marks tickets Done.
