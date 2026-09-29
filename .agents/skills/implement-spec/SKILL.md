---
name: implement-spec
description: "Implement a specification in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

Implement the whole spec on one branch based on the repository's `main` branch. Use the ticket dependencies to order the work, and leave review, merge, and Done status to a person.

## Steps

1. Read the spec and every linked ticket. Understand acceptance criteria and blockers. If the linked tickets do not cover the spec, ask for the missing tickets before starting. Read the repository's instructions and inspect the worktree and `main` branch. Choose a branch such as `spec/<spec-id>-<slug>`.

2. Before changing branches or editing code, ask the user to confirm creating or continuing that branch from `main` and keeping all spec work on it. Wait for explicit approval. Preserve existing work; if changing branches would carry or overwrite it, use an isolated worktree when supported or ask how to proceed.

3. After approval, use the repository's documented version-control workflow to create or check out the spec branch from `main`. Verify its base before editing. Work through tickets in dependency order and commit each ticket's changes on this branch; do not create a branch per ticket.

4. Set each linked ticket to Running before working on it. Implement its criteria, using `/tdd` at suitable seams, and commit its work on the spec branch. Keep unfinished tickets Running. Set a ticket back to Running before changing work that is already in Needs review. Update only tickets linked to this chat, and never mark one Done.

5. Once every ticket is implemented, run the full relevant tests and typechecks, then run `/code-review` against the spec branch. Keep tickets Running while resolving findings; commit fixes on the same branch and rerun affected checks.

6. If the repository has a configured remote, publish the branch and open one ready-for-review PR for the whole spec, linking the spec and tickets. After it opens, set the linked tickets to Needs review. If PR review asks for changes, set affected tickets back to Running before fixing them, then to Needs review after the fixes are committed, pushed to the PR, and checks pass. If there is no remote or publishing fails, leave tickets Running and report why. Do not merge or mark tickets Done; a person reviews and merges, then marks them Done.
