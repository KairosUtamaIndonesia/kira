# Cowork Mode

## Outcome

One Kira desktop app, one route tree, two shells. `Code` shell = current developer layout (sidebar + inspector + parallel worktree sessions). `Cowork` shell = chat-dominant, single default session, no worktrees, with a two-section sidebar (recent threads + projects) and a project detail page for file context and custom prompts. Toggle lives in the Sidebar header next to the "Kira" wordmark as a `DropdownMenu` listing both modes; the button label shows the current mode, picking the other switches the shell. No one-click swap — a menu is required to prevent fat-finger switching.

## User

- **Code mode:** developers / power users. Comfortable with worktrees, multiple parallel sessions, project trees, file inspectors.
- **Cowork mode:** non-developers and Claude-Desktop-comfortable users. Expect a chat-first surface with project organization (files, custom prompts), search, and a familiar sidebar layout similar to Claude Desktop / ChatGPT.
- Same person may switch between modes depending on the task. Mode is per-user, not per-workspace.

## Why now

The current UI is dev-tuned. Onboarding non-developers requires a less dense, chat-first surface. Forking the app into two products is the wrong cost; adding a second shell to the existing app is the right one.

## Success

- Switching modes feels like a layout change, not a navigation. No route change, no full reload.
- All large functional features keep working in both modes: agent threads, browser panel, agent-pi, persistence, Tauri commands, project/session data model.
- Cowork creates a `Project` (one per first message — i.e. each new thread starts in its own auto-created project) and uses the single default session. Projects can also be created explicitly from the sidebar.
- Projects are first-class in Cowork: the sidebar has a "Projects" section with collapsible groups, context menus (rename, remove, reveal folder, copy path), and a project detail page showing files and a custom prompt (`agents.md`).
- Files dropped into a Cowork project (via OS drag-drop) land in that project on disk. The project detail page shows the file list and allows setting a custom prompt.
- The sidebar has search that filters both threads and projects by name.
- The toggle is discoverable but not intrusive. Current mode is unambiguous from the label.

## Constraints

- **Single route tree.** Both modes share the same routes, components, and data. No `/cowork/...` route tree.
- **Mode-aware shell + per-mode component variants.** The shell swaps layout (sidebar collapsed/hidden, chat dominant, no inspector tree). Shared components branch on `mode` only where the visual differs. Where Cowork needs a different component (e.g. a different sidebar), it gets its own component file; the existing Code component is not mutated to accept a `mode` prop unless the variant is small.
- **Zustand for the mode store.** Persist `mode` (e.g. `localStorage` for now; Tauri store later if cross-device matters). Small slice, no global refactor.
- **Project data model is unchanged.** It is the same OS folder it is today. In Cowork it is auto-created on first message or explicitly via the sidebar; in Code it stays explicit. The word "Project" stays. No rename to "Folder."
- **Sessions stay Code-only.** Cowork uses the single default session. No session switcher in Cowork.
- **Minimal new Rust surface.** Two small Tauri commands added: `editor_file_write` (write `agents.md` to a project folder) and `project_file_copy` (copy dropped files into a project folder). Both are thin wrappers around filesystem operations with path validation. No new persistence or business logic.

## Out of scope

- Multi-webview, multi-window, or any ADR-0004 work. Single webview, in-app mode switch.
- Worktrees, parallel sessions, or session switching in Cowork.
- Renaming `Project` to `Folder` (or any other name) in code, types, or UI.
- A new global state library. Zustand already in use.
- URL-deep-linked modes. Mode is not a deep-link target for v1.
- A new composer component for Cowork in this pass — the existing composer is reused; Cowork-specific composer styling can land later as a variant if needed.

## Concrete shape (for the planning agent)

- **Mode store:** `apps/desktop/src/features/app-shell/state/modeStore.ts` (or sit beside the existing app-shell state). Exports `useModeStore` with `{ mode: 'code' | 'cowork', setMode, toggleMode }`. Persisted.
- **Shell switch:** `apps/desktop/src/features/app-shell/components/Shell.tsx` (or current equivalent) reads `mode` and renders `<CodeShell>` or `<CoworkShell>`. Both shells render the same `<Outlet />` / route content.
- **Toggle UI:** Modify the existing Sidebar header (the one that currently shows "Kira") to render `Kira · <ModeMenuButton>`. `ModeMenuButton` is a `DropdownMenu` trigger showing the current mode label, with items `Code` and `Cowork`. Selecting an item calls `setMode`. Use existing `DropdownMenu` shadcn primitive.
- **Cowork shell components:**
  - `apps/desktop/src/features/app-shell/components/CoworkShell.tsx` — single-column layout, chat-first. Uses a `CoworkView` discriminated union (`chat | project-detail | empty`) for view state.
  - `apps/desktop/src/features/app-shell/components/CoworkSidebar.tsx` — two-section sidebar: recent threads (flat, cross-project, most-recent-first) and "Projects" (collapsible groups with thread count badges, context menus, search). Uses `useCoworkThreads` and `useCoworkProjects` hooks.
  - `apps/desktop/src/features/app-shell/components/CoworkProjectDetail.tsx` — project detail page showing file list (with OS drag-drop via Tauri `onDragDropEvent`), custom prompt editor (backed by `agents.md`), and project thread list. Has rename/remove actions in the header.
- **Cowork data layer:**
  - `apps/desktop/src/features/app-shell/hooks/useCoworkThreads.ts` — threads across all Cowork projects, most-recent-first.
  - `apps/desktop/src/features/app-shell/hooks/useCoworkProjects.ts` — Cowork projects with threads grouped by project. Snapshot on mount + manual refresh.
- **Cowork project auto-create:** `createCoworkProject()` in the composer/thread-create path. Also available explicitly via the `+` button in the Projects section header. Both call the `cowork_project_create` Tauri command.
- **Reuse, don't mutate:** `AgentThreadRow` is shared between Code inspector and Cowork sidebar. `RenameProjectDialog` / `RemoveProjectDialog` patterns are reused in the Cowork sidebar (inline implementations, not imported from ProjectList to avoid coupling).

## Resolved decisions

- Mode store: `apps/desktop/src/features/app-shell/state/modeStore.ts`. Persisted in localStorage.
- Sidebar header: `Kira` + `ModeMenuButton` (DropdownMenu with Code/Cowork items).
- Data fetching: snapshot on mount + manual refresh (matches existing pattern).
- New Tauri commands: `editor_file_write` and `project_file_copy`. Small, focused, no new persistence.
