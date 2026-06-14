# Cowork Mode

## Outcome

One Kira desktop app, one route tree, two shells. `Code` shell = current developer layout (sidebar + inspector + parallel worktree sessions). `Cowork` shell = thread-first, chat-dominant, single default session, no worktrees, no project-tree chrome. Toggle lives in the Sidebar header next to the "Kira" wordmark as a `DropdownMenu` listing both modes; the button label shows the current mode, picking the other switches the shell. No one-click swap — a menu is required to prevent fat-finger switching.

## User

- **Code mode:** developers / power users. Comfortable with worktrees, multiple parallel sessions, project trees, file inspectors.
- **Cowork mode:** non-developers and Claude-Desktop-comfortable users. Expect a chat-first surface, no project-tree affordances, files dropped in become context for the conversation.
- Same person may switch between modes depending on the task. Mode is per-user, not per-workspace.

## Why now

The current UI is dev-tuned. Onboarding non-developers requires a less dense, chat-first surface. Forking the app into two products is the wrong cost; adding a second shell to the existing app is the right one.

## Success

- Switching modes feels like a layout change, not a navigation. No route change, no full reload.
- All large functional features keep working in both modes: agent threads, browser panel, agent-pi, persistence, Tauri commands, project/session data model.
- Cowork creates a `Project` (one per first message — i.e. each new thread starts in its own auto-created project) and uses the single default session. The user never names a project in Cowork.
- Files dropped into a Cowork project land in that project on disk (not into a separate workspace panel).
- The toggle is discoverable but not intrusive. Current mode is unambiguous from the label.

## Constraints

- **Single route tree.** Both modes share the same routes, components, and data. No `/cowork/...` route tree.
- **Mode-aware shell + per-mode component variants.** The shell swaps layout (sidebar collapsed/hidden, chat dominant, no inspector tree). Shared components branch on `mode` only where the visual differs. Where Cowork needs a different component (e.g. a different sidebar), it gets its own component file; the existing Code component is not mutated to accept a `mode` prop unless the variant is small.
- **Zustand for the mode store.** Persist `mode` (e.g. `localStorage` for now; Tauri store later if cross-device matters). Small slice, no global refactor.
- **Project data model is unchanged.** It is the same OS folder it is today. In Cowork it is auto-created on first message and shown as a soft grouping; in Code it stays explicit. The word "Project" stays. No rename to "Folder."
- **Sessions stay Code-only.** Cowork uses the single default session. No session switcher in Cowork.
- **No new Rust / Tauri surface.** Cowork reuses the existing persistence layer and Tauri commands. Auto-creating a project on first message is a frontend orchestration of existing commands.

## Out of scope

- New Tauri commands or backend features.
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
  - `apps/desktop/src/features/app-shell/components/CoworkShell.tsx` — single-column layout, chat-first.
  - `apps/desktop/src/features/app-shell/components/CoworkSidebar.tsx` — uses the same row UI as `AgentThreadsInspector` but data sourced from a new `useAllAgentThreads` hook (cross-project). Projects shown as soft grouped sections, not as the primary nav.
- **Cowork data layer:** `apps/desktop/src/features/agent-thread/hooks/useAllAgentThreads.ts` (or feature-appropriate path) returns threads across all projects, grouped by project. The grouping is presentation-only; persistence is unchanged.
- **Cowork project auto-create:** A small `useCoworkProjectBootstrap` (or inlined in the composer/thread-create path) that, on first message in a thread, ensures a project exists. Calls existing Tauri commands to create a project + a default session if missing. Idempotent.
- **Reuse, don't mutate:** `AgentThreadsInspector`'s row component (`AgentThreadRow` and its dropdown/context menu content) is the canonical thread row. Extract it (or expose it) so both the Code inspector and the Cowork sidebar can render the same row. Do not fork the row into two divergent components.

## Open questions for the planner

- Where exactly does the mode slice live in the existing Zustand layout (sibling store vs. extended slice)? Match the existing pattern.
- Does `useAllAgentThreads` need to be reactive to cross-project thread creation, or is a snapshot on mount + manual refetch acceptable for v1? Match the existing data-fetching pattern.
- Persist mode where — `localStorage` is fine for v1, but the project already has a Tauri-side preference story. Check ADR-0001 / existing Tauri store usage and follow it.
- The Sidebar header currently says "Kira" only. Confirm the exact visual: `Kira · Code` (inline) vs `Kira` + a pill button reading `Code`. Use the existing Sidebar's typography tokens.
