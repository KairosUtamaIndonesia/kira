# Source Control with Gitoxide Plan

## Objective

Implement Kira’s Source Control inspector with the same core feature set as Orca’s source control panel, but with a Rust/Tauri backend built primarily on `gitoxide` (`gix`) instead of Electron/Node shelling out to `git`.

## Context Summary

This plan was prepared after reviewing Kira v3 and Orca’s source-control implementation.

### Kira context

Kira v3 is a Bun/Turborepo monorepo. The relevant app is the Tauri desktop app:

- Frontend root: `apps/desktop/src/`
- Rust backend root: `apps/desktop/src-tauri/src/`
- App shell inspector: `apps/desktop/src/features/app-shell/components/AppInspector.tsx`
- Project/session types: `apps/desktop/src/features/projects/types.ts`
- Project API wrappers: `apps/desktop/src/features/projects/api/projectsApi.ts`
- Tauri command registration: `apps/desktop/src-tauri/src/lib.rs`

Current Kira state:

- Tauri Rust backend exists with `projects`, `persistence`, and `terminal` modules.
- Projects have a `folderPath`, which is the natural source-control worktree path.
- The inspector already has Explorer and Source Control buttons.
- Source Control currently has placeholder content only.
- No git backend, diff panels, git state store, or hosted-provider architecture exists yet.

Project rules that affect this work:

- Keep feature-specific code near the owning feature.
- Prefer explicit typed boundaries and fail-fast errors.
- No hidden fallbacks.
- Rust app code denies `unwrap`, `expect`, `panic`, `todo`, `unimplemented`, `dbg!`, and unsafe code.
- UI changes must use existing tokens/components and avoid hardcoded colors.

### Orca context analyzed

Orca source-control source lives under `~/Workspaces/proto-kira`.

Important files reviewed:

- `src/renderer/src/components/right-sidebar/SourceControl.tsx`
- `src/main/git/status.ts`
- `src/shared/git-status-types.ts`
- `src/renderer/src/runtime/runtime-git-client.ts`

Orca’s panel feature set includes:

- Git repo detection / non-git empty states
- Branch/head/upstream/ahead/behind status
- Staged / unstaged / untracked grouping
- File filtering
- List/tree view modes
- Per-file status icons and line stats
- Stage / unstage / discard single file
- Bulk stage / unstage / discard
- Commit message composer
- Commit action
- Push / pull / sync / publish style primary actions
- Conflict detection for merge/rebase/cherry-pick
- Conflict banners and abort actions
- Diff loading for staged/unstaged/branch/commit changes
- Compare branch against base ref
- “Committed on Branch” section
- Git history panel
- PR/MR creation, GitHub/GitLab checks, AI-generated commit messages/PR fields, and diff notes

Orca’s implementation is tightly coupled to its worktree model, runtime environments, hosted-review integrations, AI settings, and diff-note systems. Kira should mirror the feature set, not the exact shape.

### Gitoxide context

Context7 and crate metadata were checked for gitoxide:

- Crate: `gix = "0.84.0"`
- Repository: <https://github.com/GitoxideLabs/gitoxide>
- Purpose: Rust implementation of Git, usable as a library.
- Relevant capabilities:
  - repository opening/discovery
  - high-level `Repository::status()` iterator
  - status via `gix-status`
  - object/blob reads
  - tree/index/worktree diff capabilities
  - commit/history-oriented APIs

Gitoxide is a good fit for local source-control state in the Rust backend. Some network or operation-heavy commands may still require explicit subprocess adapters if gitoxide APIs are not ergonomic enough for the required behavior.

## Libraries / Dependencies

### Add Rust dependencies

Modify `apps/desktop/src-tauri/Cargo.toml`:

- `gix = "0.84.0"` — primary Git implementation.
- `tokio = { version = "1", features = ["process", "io-util"] }` only if limited subprocess fallbacks are needed.
- Possibly `ignore = "0.4"` if file walking / ignore matching needs to match Git-style ignore behavior outside `gix`.
- Possibly `similar = "2"` if backend-generated text hunks are needed later; otherwise diff can start as raw left/right file contents.

### Where `git` subprocess fallback may still be justified

For full Orca parity, some operations are riskier to reimplement immediately with pure `gix`:

- push / pull / fetch / publish
- rebase / merge abort
- some conflict operation detection
- hosted-provider CLI integration, if ever using `gh` / `glab`

Recommended approach: use `gix` for local repo state and mutation where it is strong; use explicit, isolated subprocess adapters only for network/operation commands that gitoxide does not cover ergonomically. No hidden fallback: each command’s implementation strategy should be explicit.

## Files

### Rust backend

- `apps/desktop/src-tauri/Cargo.toml` — modify  
  Add `gix` and any explicit support crates.

- `apps/desktop/src-tauri/src/lib.rs` — modify  
  Register source-control Tauri commands.

- `apps/desktop/src-tauri/src/source_control.rs` — create  
  Tauri command boundary, request/response DTOs, error type.

- `apps/desktop/src-tauri/src/source_control/git.rs` — create  
  Core gitoxide-backed repository operations.

- `apps/desktop/src-tauri/src/source_control/status.rs` — create  
  Status mapping into frontend-safe DTOs.

- `apps/desktop/src-tauri/src/source_control/diff.rs` — create  
  Blob/file content loading for staged, unstaged, committed, and branch diffs.

- `apps/desktop/src-tauri/src/source_control/commit.rs` — create  
  Stage/unstage/discard/commit operations.

- `apps/desktop/src-tauri/src/source_control/history.rs` — create  
  Commit history and commit compare support.

- `apps/desktop/src-tauri/src/source_control/remote.rs` — create later / phase 2  
  Push/pull/fetch/publish using either `gix` remote support or explicit git subprocess calls.

- `apps/desktop/src-tauri/src/source_control/tests.rs` or module-local tests — create  
  Rust unit/integration tests around temp git repositories.

### Frontend API/types

- `apps/desktop/src/features/source-control/types.ts` — create  
  TypeScript mirrors of Rust DTOs.

- `apps/desktop/src/features/source-control/api/sourceControlApi.ts` — create  
  Typed Tauri `invoke` wrappers.

- `apps/desktop/src/features/source-control/hooks/useSourceControlStatus.ts` — create  
  Poll/refresh active project source-control state.

- `apps/desktop/src/features/source-control/components/SourceControlInspector.tsx` — create  
  Main inspector panel.

- `apps/desktop/src/features/source-control/components/SourceControlSection.tsx` — create  
  Staged/unstaged/untracked section UI.

- `apps/desktop/src/features/source-control/components/SourceControlFileRow.tsx` — create  
  File row with status decoration/actions.

- `apps/desktop/src/features/source-control/components/CommitArea.tsx` — create  
  Commit message + primary action area.

- `apps/desktop/src/features/source-control/components/SourceControlEmptyState.tsx` — create  
  Non-git / clean / no project states.

- `apps/desktop/src/features/source-control/components/SourceControlFilter.tsx` — create  
  Filter input.

- `apps/desktop/src/features/app-shell/components/AppInspector.tsx` — modify  
  Replace placeholder source-control content with `SourceControlInspector`.

### Later diff/workspace integration

- `apps/desktop/src/features/workspace/...` — modify/create later  
  Add diff panels once source-control rows need to open diffs in the workspace.

## Execution Steps

### Phase 1 — Backend contract and local status

1. Add source-control Rust module and DTOs.
2. Add `source_control_status` command.
3. Implement repo discovery from project `folderPath`.
4. Return:
   - repo kind: git / not git
   - branch
   - head oid
   - upstream status if available
   - conflict operation
   - entries grouped by `area`: staged / unstaged / untracked
   - status: modified / added / deleted / renamed / copied / untracked
   - line counts where practical
5. Add tests using temp repos:
   - clean repo
   - modified file
   - staged file
   - untracked file
   - deleted file
   - renamed file if `gix` exposes enough info cleanly

### Phase 2 — Inspector UI MVP

1. Create `features/source-control`.
2. Add typed Tauri client wrappers.
3. Replace placeholder Source Control content in `AppInspector`.
4. Render:
   - non-git empty state
   - loading/error states
   - branch header
   - filter input
   - staged / unstaged / untracked sections
   - status icons using git decoration tokens
   - refresh button
5. Add polling/refresh behavior only while Source Control is active.

### Phase 3 — Mutations

1. Add backend commands:
   - stage file
   - unstage file
   - discard file
   - bulk stage
   - bulk unstage
   - bulk discard
   - commit
2. Add frontend row/section actions.
3. Add confirmation dialog before discard/delete.
4. Refresh status after every mutation.
5. Add tests around mutation behavior.

### Phase 4 — Diffs

1. Add backend diff content commands:
   - unstaged diff content
   - staged diff content
   - committed/branch diff content
2. Create workspace diff panel type if needed.
3. Wire file row click to open diff panel.
4. Handle binary files explicitly.
5. Avoid claiming diff availability for unresolved conflicts until conflict support is built.

### Phase 5 — Branch compare and history

1. Add branch compare command:
   - base ref
   - merge base
   - changed files
   - commits ahead
2. Add “All / Uncommitted” scope like Orca.
3. Add “Committed on Branch” section.
4. Add commit history command and collapsed history panel.

### Phase 6 — Remote actions

1. Add explicit remote action command surface:
   - fetch
   - pull
   - push
   - publish branch
   - sync
2. Decide per operation whether `gix` is sufficient or whether to shell out to `git`.
3. Keep subprocess usage isolated in `source_control/remote.rs`.
4. Add clear error messages for auth/network failures.

### Phase 7 — Conflict support

1. Detect merge/rebase/cherry-pick state.
2. Surface conflict banners.
3. Mark unresolved conflict entries.
4. Add abort merge/rebase/cherry-pick actions.
5. Add conflict-safe staging rules.

### Phase 8 — Hosted review / AI parity

This is not part of the first source-control foundation unless immediate full Orca parity is required.

Later features:

- GitHub/GitLab PR/MR discovery
- create PR/MR
- PR/MR status/check panels
- AI-generated commit messages
- AI-generated PR fields
- diff notes

These require separate provider/auth/AI architecture decisions in Kira, which the current repo does not appear to have yet.

## Decision Log

### Decision: Use `gix` as the default local git engine

Chosen because it fits the Rust backend, avoids Node/Electron git wrappers, and supports repository/status/object workflows.

Alternative: shell out to `git` for everything. Rejected because the requested direction is gitoxide and Kira already has a Rust backend.

### Decision: Do not clone Orca’s giant component shape

Orca’s `SourceControl.tsx` is very large and tied to app-specific worktrees, hosted reviews, AI, diff notes, and runtime environments. Kira should use the same feature set but split into smaller feature-owned modules.

### Decision: Build source control in phases

Full Orca parity crosses local Git, remotes, hosted providers, AI, conflict review, and workspace diff surfaces. Building all at once would create a high-risk blob. The phase plan keeps each layer verifiable.

### Decision: Allow explicit subprocess use for remote operations if needed

Gitoxide is strongest for local repository mechanics. Network operations, auth, push/pull/rebase ergonomics may be safer initially through a narrow `git` subprocess adapter. This should be explicit, not a hidden fallback.

## Risks & Impact

- **Gitoxide API complexity:** medium risk. Mitigation: isolate in Rust modules and test against real temp repos.
- **Feature parity scope:** high risk if attempted in one pass. Mitigation: phase local source-control first.
- **Discard operations:** high risk because they delete data. Mitigation: validate paths stay inside worktree, require confirmation, add tests.
- **Remote operations/auth:** high risk. Mitigation: defer until local source control is stable.
- **UI scope creep:** medium risk. Mitigation: start with Source Control inspector; add workspace diff panels only when needed.
- **No current frontend test harness observed:** verification may rely on Rust tests plus `bun run check` until frontend test conventions exist.

## Recommended First Implementation Slice

Implement Phases 1–3 first:

1. Git status backend with `gix`
2. Source Control inspector UI
3. Stage / unstage / discard / commit

That gives Kira a useful Source Control panel quickly and creates the contract needed for diffs, branch compare, history, remotes, and AI afterward.

## Approval Gate

Before implementation, confirm the desired first slice. Recommended approval wording:

> approved — start with backend status contract + Source Control inspector UI + local mutations
