# Domain Language

## Language

**Kira**:
The desktop application being built in this repository. Kira is a Tauri app with a React frontend and a Rust backend.
_Avoid_: App as a domain name, generic product placeholders

**App Shell**:
The persistent application frame that owns the sidebar, workspace, inspector, and status bar layout.
_Avoid_: Main page, dashboard

**Workspace**:
The central dockable area where the user opens, splits, and arranges panels.
_Avoid_: Editor when referring to the whole dockable area

**Panel**:
A dockable workspace surface with its own title, content, and lifecycle.
_Avoid_: Tab when the behavior includes docking or splitting

**Terminal Panel**:
A workspace panel that displays and controls a terminal session.
_Avoid_: Shell panel, console panel

**Terminal Session**:
A backend-owned PTY process connected to one terminal panel by a stable session id.
_Avoid_: Terminal instance when referring to the backend process

**Agent Session**:
A workspace panel or future domain surface for interacting with an AI agent run.
_Avoid_: Chat when the interaction includes tools, execution, or run state

**Run**:
A tracked execution of an agent, command, or workflow.
_Avoid_: Job unless referring to an external scheduler concept

**Inspector**:
The right-side application area for contextual details, metadata, or controls related to the current selection.
_Avoid_: Details sidebar when distinguishing it from the primary sidebar

**Sidebar**:
The left-side navigation area for primary app destinations.
_Avoid_: Navigation when referring to the visual region

**Status Bar**:
The bottom application area for concise global state and operational feedback.
_Avoid_: Footer

**Persistence Store**:
The app-owned durable data store, currently expected to be SQLite through the Rust backend.
_Avoid_: Database when discussing the product boundary rather than the implementation
