# Memory Viewer

## Problem Statement

How might we let users browse and edit their agent's persistent memory (user profile, agent notes, failure records, and project-scoped facts) from within the desktop Settings UI — without needing to chat with the agent or remember slash commands?

## Recommended Direction

**Option C — Direct filesystem read + edit via Tauri commands, presented as a new "Memory" settings section under Agent with tabbed store navigation.**

Memory is stored as plain text files on disk (`$app_data/.agent/data/{MEMORY,USER,failures}.md`, plus per-project `MEMORY.md`). Each file uses a simple `§` delimiter between entries with HTML-comment metadata (`<!-- created=..., last=... -->`). This format is trivially parsed and written from Rust.

The UI follows the existing Settings sidebar pattern — a single new "Memory" entry under the Agent group, with tabs inside (User / Notes / Failures / Project <selector>). Each tab shows a list of entries with inline edit and delete. The Rust backend exposes three new Tauri commands: `memory_get_entries`, `memory_update_entry`, and `memory_list_projects`.

This approach avoids adding IPC complexity with the agent-pi process, keeps the canonical files as source of truth, and reuses the existing `PersistenceStore.app_data_dir()` path that's already managed Tauri state.

## Key Assumptions to Validate

- [ ] **Agent-pi is not writing during manual edits** — The agent loads files into memory at start and writes them back on save. If the user edits a file in Settings while the agent is also writing, the last writer wins. For a single user working normally (agent writes at turn boundaries, user edits between sessions or during idle), this is safe. Validate by observing real usage — if races occur, add a simple lock file or gate editing when agent runtime reports it's "busy".
- [ ] **§ delimiter never appears in natural content** — The parser splits on `\n§\n`. If an entry legitimately contains that sequence, it would fragment. The agent never writes it because `scanContent()` would reject it, but user edits could introduce it. Mitigation: validate content on write.
- [ ] **App data dir is accessible** — `PersistenceStore.app_data_dir()` resolves to a writable path on all platforms. It already works for the agent runtime and projects system. Low risk.

## MVP Scope

**In scope:**

- New "Memory" settings section under Agent with id `"memory"`
- Tab bar: User / Notes / Failures / Project
- Project tab includes a dropdown to select which project's memory to view (reads `<projects-dir>/<projectId>/MEMORY.md`)
- Each tab lists entries with:
  - Full text display (not truncated)
  - "Edit" button → inline textarea with save/cancel
  - "Delete" button → confirmation → remove entry + rewrite file
- "Add entry" button at bottom of each tab, appends to the respective file
- Tauri commands: `memory_get_entries`, `memory_update_entry`, `memory_list_projects`
- Read metadata (created/last-referenced dates) and show them subtly (e.g. `— saved Jun 10`)

**Out of scope (MVP):**

- Search/filter across entries
- Undo for edits/deletes
- Drag-to-reorder entries
- Real-time sync with running agent-pi process
- Failure memory auto-categorization display
- Export or bulk operations

## Not Doing (and Why)

- **Proxy through agent-pi IPC** — Adds complexity without benefit for a read/view feature. The filesystem is the source of truth; reading it directly is simpler, faster, and works whether or not the agent runtime is running.
- **SQLite-backed viewer (Option F)** — The SQLite store is a search index that can be stale. For an editing feature, reading and writing the canonical files is correct by construction.
- **Separate floating panel outside Settings** — Adding a new top-level UI surface (like skills inspector) increases scope. Settings is the natural home for configuration and inspection. Can be promoted later if discoverability is a problem.
- **Real-time agent sync** — Making the viewer respond to agent writes in real time requires either polling the filesystem or wiring agent-pi events to the frontend. Neither is justified for MVP. The "last saved" timestamp tells the user how fresh the data is.
- **Edits through the agent's memory tool** — Running an LLM call to edit a single entry is wasteful when the file format is trivially parseable. Direct file writes are instant, deterministic, and don't consume tokens.

## Open Questions

- Should the Project tab default to the currently active workspace, or should the user always pick from a list? Defaulting to the active workspace is more intuitive but requires plumbing the current project ID through the frontend.
- Should editing auto-consolidate if the entry is too long? (The agent's `addCore` enforces a ~5KB char limit. Direct file writes bypass this. Mitigation: enforce the same limit in the Tauri command.)
- What happens when the user deletes the last entry in a file? The file becomes empty (or is removed). The agent handles empty files gracefully.
