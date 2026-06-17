# Implementation Plan: Wire Memory Extension to Kira Project Identity

## Overview

The memory extension's "project" concept derives identity from `path.basename(cwd)` — a filesystem heuristic that collides on same-named directories and has no stable identity. Kira Projects have stable UUIDs from the persistence store. This plan bridges the two so memory is keyed by Kira project id instead of directory basename.

## Architecture Decision

**Pass project identity through the existing `AgentThreadContext` registry, not through environment variables or SDK changes.**

The `agent-session-host.ts` already receives `AgentThreadContext { projectId, sessionId, threadId, projectPath }` before creating the ResourceLoader that instantiates the memory extension. We add a module-level "current project" slot that `buildAgentSession` sets before extension creation and the memory extension reads during its factory call. This is safe because Node.js is single-threaded and `buildAgentSession` is synchronous through the ResourceLoader creation phase.

**Why not env vars:** The agent-pi process is shared across all threads. `process.env` mutation is visible globally and could race if two sessions build concurrently (unlikely today, but fragile).

**Why not SDK changes:** The `ExtensionFactory = (pi: ExtensionAPI) => void` signature is external. We don't own it.

## Dependency Graph

```
agent-thread-context.ts (add currentProjectId slot)
    │
    ├── agent-session-host.ts (set slot before build)
    │       │
    │       └── extensions/memory/index.ts (read slot, replace detectProject)
    │               │
    │               ├── extensions/memory/project.ts (accept projectId param)
    │               │
    │               └── extensions/memory/tools/memory-tool.ts (use projectId for SQLite)
    │
    └── extensions/memory/env.ts (add readOptionalEnv reader — optional, for env var fallback)
```

## Task List

### Phase 1: Plumbing

#### Task 1: Add current project id slot to agent-thread-context

**Description:** Add a module-level `currentProjectId: string | undefined` variable with setter/getter to `agent-thread-context.ts`. This is the bridge between the session host (which knows the Kira project id) and the memory extension (which needs it).

**Acceptance criteria:**

- [ ] `setCurrentProjectId(id: string | undefined)` exported
- [ ] `getCurrentProjectId(): string | undefined` exported
- [ ] No other changes to existing `AgentThreadContext` registry

**Files likely touched:**

- `apps/desktop/agent-pi/src/kira/agent-thread-context.ts`

**Estimated scope:** XS (1 file)

---

#### Task 2: Set current project id before session build

**Description:** In `agent-session-host.ts`, call `setCurrentProjectId(context.projectId)` before `buildAgentSession(context)` and clear it after the ResourceLoader is created (the extension factory runs during `resourceLoader.reload()`).

**Acceptance criteria:**

- [ ] `setCurrentProjectId` called before `resourceLoader.reload()`
- [ ] Slot cleared after reload completes (prevents stale state for future builds)
- [ ] Existing session creation flow unchanged

**Dependencies:** Task 1

**Files likely touched:**

- `apps/desktop/agent-pi/src/kira/agent-session-host.ts`

**Estimated scope:** XS (1 file)

---

### Phase 2: Memory Extension Integration

#### Task 3: Replace detectProject with Kira project id in memory extension

**Description:** In `memory/index.ts`, read the current project id via `getCurrentProjectId()`. Use it to derive the project memory directory (`AGENT_ROOT/projects/<projectId>/`) instead of `AGENT_ROOT/projects/<basename(cwd)>/`. Fall back to the basename heuristic when no project id is set (e.g., standalone agent-pi usage outside Kira).

**Acceptance criteria:**

- [ ] When `getCurrentProjectId()` returns a string, project memory dir uses `<projectId>` as the directory name
- [ ] When `getCurrentProjectId()` returns `undefined`, falls back to `detectProject()` basename heuristic
- [ ] `projectName` for display purposes still derived from `path.basename(cwd)` (the display name is separate from the storage key)
- [ ] Project store created with the new path
- [ ] SkillStore receives the new project path

**Dependencies:** Task 2

**Files likely touched:**

- `apps/desktop/agent-pi/src/kira/extensions/memory/index.ts`

**Estimated scope:** S (1 file, ~20 lines changed)

---

#### Task 4: Update project.ts to accept explicit project id

**Description:** Add an optional `projectId` parameter to `detectProject()` (or create a new `resolveProjectIdentity()` function). When `projectId` is provided, use it directly as the directory name instead of `path.basename(cwd)`. The display name (`name` field) continues to use `path.basename(cwd)` since it's used for UI labels like `PROJECT MEMORY: <name>`.

**Acceptance criteria:**

- [ ] New parameter accepted without breaking existing callers
- [ ] When `projectId` provided: `memoryDir` uses `projectId` as path segment
- [ ] When `projectId` absent: existing basename behavior preserved
- [ ] `name` (display name) always uses `path.basename(cwd)` regardless of projectId

**Dependencies:** None

**Files likely touched:**

- `apps/desktop/agent-pi/src/kira/extensions/memory/project.ts`

**Estimated scope:** XS (1 file)

---

#### Task 5: Use Kira project id for SQLite memory sync

**Description:** The `memory` tool currently passes `projectName` (display name) to `sqliteProjectFor()` when syncing entries to SQLite. Change this to pass the Kira project id instead, so SQLite entries are keyed by stable identity. The `memory_search` tool's `project` filter parameter should also accept project ids.

**Acceptance criteria:**

- [ ] `createMemoryToolDef` receives `projectId` (stable id) separate from `projectName` (display name)
- [ ] `sqliteProjectFor()` uses `projectId` for the SQLite `project` column
- [ ] System prompt rendering (`formatProjectBlock`) still uses `projectName` for display
- [ ] `memory_search` tool's `project` filter works with project ids
- [ ] Existing global memory entries (project=NULL in SQLite) unaffected

**Dependencies:** Task 3

**Files likely touched:**

- `apps/desktop/agent-pi/src/kira/extensions/memory/tools/memory-tool.ts`
- `apps/desktop/agent-pi/src/kira/extensions/memory/tools/memory-search-tool.ts` (prompt/docs only)

**Estimated scope:** S (1-2 files)

---

### Phase 3: Handlers and Edge Cases

#### Task 6: Update switch-project command for project id awareness

**Description:** The `/memory-switch-project` command lists project directories by basename. Update it to display project ids when available, and handle the new directory naming scheme.

**Acceptance criteria:**

- [ ] Lists both old-style (basename) and new-style (project-id) project directories
- [ ] Display shows project name (basename) alongside project id when distinguishable
- [ ] Backward compatible: old basename directories still accessible

**Dependencies:** Task 3

**Files likely touched:**

- `apps/desktop/agent-pi/src/kira/extensions/memory/handlers/switch-project.ts`

**Estimated scope:** S (1 file)

---

#### Task 7: Update background review and session flush for project id

**Description:** The background review and session flush handlers receive `projectStore` and `projectName`. Ensure they pass the correct project id (not name) when syncing to SQLite.

**Acceptance criteria:**

- [ ] Background review syncs failure/correction memories with project id
- [ ] Session flush syncs with project id
- [ ] Correction detector syncs with project id

**Dependencies:** Task 5

**Files likely touched:**

- `apps/desktop/agent-pi/src/kira/extensions/memory/handlers/background-review.ts`
- `apps/desktop/agent-pi/src/kira/extensions/memory/handlers/session-flush.ts`
- `apps/desktop/agent-pi/src/kira/extensions/memory/handlers/correction-detector.ts`

**Estimated scope:** S (2-3 files, small changes in each)

---

### Phase 4: Verification

#### Task 8: Verify end-to-end memory flow with Kira project

**Description:** Manual verification that memory written in one Agent Thread of a Kira Project is discoverable in another thread of the same project, and not mixed with other projects.

**Acceptance criteria:**

- [ ] `memory` tool with `target="project"` writes to `AGENT_ROOT/projects/<projectId>/MEMORY.md`
- [ ] `memory_search` with `project=<projectId>` finds project-scoped entries
- [ ] System prompt shows `PROJECT MEMORY: <displayName>` with correct content
- [ ] Global memory (`target="memory"`) unaffected
- [ ] Two projects with same display name (e.g., two "api" repos) get separate memory stores

**Dependencies:** All previous tasks

**Estimated scope:** Verification only

---

## Checkpoint: After Tasks 1-2

- [ ] Agent-thread-context has project id slot
- [ ] Session host sets it before extension creation
- [ ] No behavior change yet (memory extension doesn't read it)

## Checkpoint: After Tasks 3-5

- [ ] Memory extension uses Kira project id for directory naming
- [ ] SQLite synced with project id
- [ ] Falls back gracefully when no project id (standalone mode)

## Checkpoint: After Tasks 6-7

- [ ] All handlers consistent with project id
- [ ] Switch-project command aware of new scheme

## Checkpoint: Complete (After Task 8)

- [ ] End-to-end verified
- [ ] No regressions in global memory

## Risks and Mitigations

| Risk                                                                              | Impact                                                    | Mitigation                                                                                                      |
| --------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Existing project memory dirs keyed by basename become orphaned                    | Low — users lose access to old project memory             | One-time migration script or runtime detection: if `<basename>` dir exists and `<projectId>` doesn't, rename it |
| Concurrent `buildAgentSession` calls race on the module-level slot                | Very low — Node.js is single-threaded through sync phases | Clear slot immediately after `resourceLoader.reload()` returns                                                  |
| `projectId` not set when memory extension loads (e.g., title generation endpoint) | Low — falls back to basename heuristic                    | Fallback in Task 3 handles this                                                                                 |

## Migration Consideration

Existing users have project memory at `AGENT_ROOT/projects/<basename>/`. After this change, new project memory goes to `AGENT_ROOT/projects/<projectId>/`. Options:

1. **Lazy migration**: On first access, if `<projectId>` dir doesn't exist but `<basename>` does, rename it. Simple, one-time cost.
2. **No migration**: Old dirs become invisible. Users re-save important memories. Acceptable if project memory is not heavily used yet.
3. **Dual lookup**: Check `<projectId>` first, fall back to `<basename>`. Most robust but adds complexity.

**Recommendation:** Option 1 (lazy migration) — implement as a `migrateProjectMemoryDir()` helper called in Task 3 during `session_start`.

## Open Questions (Resolved)

- [x] **Cowork projects** — Use project id for memory storage. (Per user decision.)
- [x] **`memory_search` tool `project` filter** — Accept id only, no display name fallback. (Per user decision.)
