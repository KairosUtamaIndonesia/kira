# Implementation Plan: Memory Viewer (Settings → Agent → Memory)

## Overview

A new "Memory" section under Settings → Agent that lets users browse and edit the agent's persistent memory stores (user profile, agent notes, failure records, and per-project memories) by reading/writing the canonical markdown files directly from the Tauri Rust backend.

## Architecture Decisions

- **Direct filesystem reads (Option C)** — bypasses agent-pi IPC. Memory files live at `$app_data/.agent/data/{MEMORY.md,USER.md,failures.md}` and per-project at `$app_data/.agent/projects/<projectId>/MEMORY.md`. Format: `§`-delimited entries with `<!-- created=..., last=... -->` metadata. Source of truth, trivially parseable.
- **New Rust module `memory.rs`** — follows `editor.rs`/`settings.rs` pattern. Uses `PersistenceStore` managed state for `app_data_dir()` and `pool()`.
- **Provider pattern** — `MemorySettingsProvider` wraps the app (matching Guardrails/Notification/Terminal convention), but for MVP it's simple: fetch on mount, provide entries + mutation callbacks via context.
- **Tabs UI** — Custom inline tab bar (no shadcn tab dependency) with User / Notes / Failures / Project <dropdown>.
- **5KB char limit enforced** — both on input and after edit, matching `DEFAULT_MEMORY_CHAR_LIMIT` in the agent.
- **Project dropdown lists all projects with memory files** — scans `.agent/projects/` for dirs containing `MEMORY.md`, cross-references UUID dir names against the `projects` SQLite table for display names.

## Task List

### Phase 1: Foundation (Rust Backend)

#### Task 1: Create `src-tauri/src/memory.rs` with 3 Tauri commands

**Description:** New Rust module that reads/writes memory markdown files on disk. Three commands:

- `memory_list_projects` — scan `.agent/projects/` for directories containing `MEMORY.md`, look up project names from SQLite `projects` table, return `Vec<ProjectMemoryInfo>`
- `memory_get_entries` — read specified store file (user/memory/failure/project), parse `§` delimiters + `<!-- created=X, last=Y -->` metadata, return `Vec<MemoryEntry>` with stripped content + dates
- `memory_update_entry` — accept `{ store, action, content, oldContent?, projectId? }`, validate 5KB limit on content, perform add/edit/delete, rewrite the file atomically (temp file + rename)

**Acceptance criteria:**

- [ ] File reads and parses correctly for all store types (user, memory, failure, project)
- [ ] `<!-- created=..., last=... -->` metadata is stripped from content but returned as separate fields
- [ ] Empty files return `[]`, missing files return `[]`
- [ ] Add entry appends to file with fresh metadata date
- [ ] Edit entry matches by stripped content (exact match on `oldContent`), updates content + `last` date
- [ ] Delete entry removes matching entry and rewrites file
- [ ] 5KB char limit enforced on content length for add/edit; returns error if exceeded
- [ ] Atomic write pattern: write to temp file in same directory, then `fs::rename`
- [ ] `memory_list_projects` scans subdirectories, checks for `MEMORY.md`, queries project names from SQLite

**Verification:**

- [ ] Build succeeds: `cargo build` or `bun run check:rust`
- [ ] Clippy passes: `bun run lint:rust`

**Dependencies:** None (uses existing `PersistenceStore`)

**Files likely touched:**

- `apps/desktop/src-tauri/src/memory.rs` (new)
- `apps/desktop/src-tauri/src/lib.rs` (add `mod memory;` and commands to `invoke_handler`)

**Estimated scope:** Medium (1 new file, ~150 lines)

---

#### Task 2: Wire into `lib.rs`

**Description:** Register the new `memory` module and its three commands in the Tauri invoke handler.

**Acceptance criteria:**

- [ ] `mod memory;` added to module declarations
- [ ] `memory::memory_list_projects`, `memory::memory_get_entries`, `memory::memory_update_entry` added to `generate_handler![]`

**Verification:**

- [ ] Build succeeds

**Dependencies:** Task 1

**Files touched:**

- `apps/desktop/src-tauri/src/lib.rs`

**Estimated scope:** XS (2 lines)

---

### Checkpoint: Rust Backend

- [ ] `bun run check:rust` passes
- [ ] `bun run lint:rust` passes
- [ ] Manual test: `curl` or Tauri invoke from devtools to verify each command returns correct data

---

### Phase 2: Frontend Data Layer

#### Task 3: Add TypeScript types and API client

**Description:** Define frontend types for memory entries and project memory info. Create `memoryApi.ts` with `invoke` wrappers for the three Tauri commands.

**Acceptance criteria:**

- [ ] Types `MemoryEntry`, `ProjectMemoryInfo`, `MemoryStoreType`, `MemoryUpdateInput`, `MemoryActionResult` defined
- [ ] `getMemoryEntries(store, projectId?)` returns `MemoryEntry[]`
- [ ] `listMemoryProjects()` returns `ProjectMemoryInfo[]`
- [ ] `updateMemoryEntry(input)` returns `{ success, error? }`
- [ ] 5KB limit enforced client-side too (preemptive check before sending to Tauri)

**Verification:**

- [ ] `bun run check` passes (TypeScript)
- [ ] `bun run lint` passes

**Dependencies:** Task 1, Task 2

**Files likely touched:**

- `apps/desktop/src/features/memory/types.ts` (new)
- `apps/desktop/src/features/memory/api/memoryApi.ts` (new)

**Estimated scope:** Small (~60 lines total)

---

#### Task 4: Create MemorySettingsProvider + context

**Description:** Following the Guardrails/Terminal pattern, create a provider that:

- Fetches entries on mount for all store types (user, memory, failure)
- Fetches project list for `memoryListProjects()`
- Provides entries, project list, loading state, error state, and mutation callbacks via context
- Accepts `activeProjectId` state for project store switching

**Acceptance criteria:**

- [ ] Provider fetches user/memory/failure entries on mount
- [ ] Provider fetches project list on mount
- [ ] Provider provides `entries`, `projectList`, `status`, `errorMessage`
- [ ] Provider provides `updateEntry(store, action, content, oldContent?, projectId?)` async callback
- [ ] Provider provides `refreshEntries()` to re-fetch
- [ ] Loading state shows skeleton, error state surfaces the error message

**Verification:**

- [ ] `bun run check` passes

**Dependencies:** Task 3

**Files likely touched:**

- `apps/desktop/src/features/memory/memorySettings.tsx` (new)

**Estimated scope:** Small (~80 lines)

---

### Checkpoint: Frontend Data Layer

- [ ] `bun run check` passes
- [ ] Provider can fetch and surface data

---

### Phase 3: UI

#### Task 5: Create MemorySettings component with tabs, read view, and edit/delete/add

**Description:** The main settings component with:

- Tab bar: User | Notes | Failures | Project <dropdown>
- Project tab shows a `<select>` populated from `projectList`, defaults to "Select a project..."
- Entry list for active tab, each entry showing:
  - Full text content
  - Subtle "created X, last referenced Y" metadata line
  - Edit and Delete buttons
- Inline edit: clicking Edit replaces the entry text with a `<textarea>`, Save writes back
- Delete: confirmation toast/dialog, then removes entry
- Add entry: button at bottom opens a new textarea, Save appends
- Loading spinner, error state with retry button
- Empty state: "No entries yet" per tab
- 5KB counter visible near the textarea during edit/add

**Acceptance criteria:**

- [ ] Tabs switch between store views
- [ ] Project dropdown lists projects from `listMemoryProjects()`
- [ ] Entry text is displayed with metadata line
- [ ] Edit → textarea with current content → Save calls `updateEntry` → re-fetches
- [ ] Delete → confirmation → calls `updateEntry` → re-fetches
- [ ] Add → empty textarea → Save calls `updateEntry` → re-fetches
- [ ] Textarea shows character count / 5000, disables Save when over limit
- [ ] Error state shows message with retry button
- [ ] Empty state shows descriptive message

**Verification:**

- [ ] `bun run check` passes
- [ ] Manual: Settings → Agent → Memory, switch tabs, see entries, edit, delete, add

**Dependencies:** Task 4

**Files likely touched:**

- `apps/desktop/src/features/memory/sections/MemorySettings.tsx` (new)
- `apps/desktop/src/features/memory/sections/memorySettingsSection.ts` (new)

**Estimated scope:** Medium (~250 lines)

---

#### Task 6: Wire section into Settings + Provider into App

**Description:** Register the memory settings section in `settingsSections.ts` under the Agent group, and mount `MemorySettingsProvider` in `App.tsx`.

**Acceptance criteria:**

- [ ] "Memory" entry appears in Settings sidebar under Agent group with an icon
- [ ] Clicking "Memory" renders the MemorySettings component
- [ ] `MemorySettingsProvider` wraps the app in `App.tsx`

**Verification:**

- [ ] `bun run check` passes
- [ ] Manual: navigate Settings → Agent → Memory, verify it loads and works

**Dependencies:** Task 5

**Files likely touched:**

- `apps/desktop/src/features/settings/settingsSections.ts`
- `apps/desktop/src/features/settings/index.ts` (add exports)
- `apps/desktop/src/App.tsx`

**Estimated scope:** Small (~10 lines)

---

### Checkpoint: Complete

- [ ] `bun run check` passes
- [ ] `bun run lint:all` passes
- [ ] Manual test: open Settings → Agent → Memory, browse all tabs, edit an entry, delete an entry, add an entry, verify file changes on disk

---

## Risks and Mitigations

| Risk                                                                 | Impact | Mitigation                                                                                                                                                                   |
| -------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Race condition: agent-pi writes to file while user edits in Settings | Med    | Agent writes are atomic (temp + rename). Reads see consistent state. Last writer wins — acceptable for single-user desktop app.                                              |
| File encoding issues on Windows (BOM, CRLF)                          | Low    | Use `std::fs::read_to_string` which handles UTF-8 and normalizes line endings. Confirm on Windows.                                                                           |
| Directory `.agent/projects/` doesn't exist yet                       | Low    | Returns empty list — handled gracefully in frontend as "No projects with memory" dropdown placeholder.                                                                       |
| Empty `.agent/data/` directories                                     | Low    | `memory_get_entries` returns `[]` for missing files. No crash.                                                                                                               |
| User enters `§` in entry content                                     | Low    | The parser splits on `\n§\n`. A `§` within an entry is fine; the full `\n§\n` sequence in content would fragment. Add content validation in Rust to reject `\n§\n` in input. |

## Open Questions

- Icon for the Memory section — `BrainCircuit` from lucide-react seems appropriate, or `Database`. Confirm.
