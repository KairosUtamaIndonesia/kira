# Agent Runtime Instructions

This package hosts Kira's desktop agent runtime sidecar process.

## Ownership

- Package name: `@kira/agent-runtime`
- Runtime: Bun + TypeScript
- Owner: `apps/desktop/`
- Purpose: host Flue-backed Agent Threads behind a localhost HTTP/WebSocket boundary managed by Tauri.

Keep this package focused on agent runtime behavior. Do not turn it into a shared utility package.

## Architecture Boundary

- Rust/Tauri owns process supervision, app lifecycle integration, frontend event delivery, and writes to the Kira Persistence Store.
- The Kira Persistence Store is SQLite through the Rust backend. Do not write to Kira SQLite directly from this package.
- React should communicate through Tauri/Rust, not directly with this runtime.
- The runtime binds only to `127.0.0.1`, uses a random Rust-provided port, and requires a random Rust-provided bearer token.
- This runtime may emit Flue-shaped runtime events and Kira `app:*` events for Rust to persist or forward.

Relevant Kira docs:

- `../../../AGENTS.md`
- `../../../docs/domain-language.md`
- `../../../docs/adr/0001-rust-owned-sqlite-persistence-store.md`
- `../../../docs/adr/0002-monorepo-hosted-admin-boundary.md`

## Flue Source Reference

Use the published Flue packages once dependency wiring is added. Use the local Flue checkout as the source reference when changing Flue integration behavior:

- Flue source root: `C:/Users/BrandonRaphaelValent/Workspaces/.flue-source/`
- Runtime source: `C:/Users/BrandonRaphaelValent/Workspaces/.flue-source/packages/runtime/src/`
- Runtime README: `C:/Users/BrandonRaphaelValent/Workspaces/.flue-source/packages/runtime/README.md`
- Examples: `C:/Users/BrandonRaphaelValent/Workspaces/.flue-source/examples/`
- Documentation app content: `C:/Users/BrandonRaphaelValent/Workspaces/.flue-source/apps/docs/src/content/docs/`
- SDK docs: `C:/Users/BrandonRaphaelValent/Workspaces/.flue-source/apps/docs/src/content/docs/sdk/`

Read the docs app content before making claims about Flue's SDK, HTTP APIs, WebSocket protocol, CLI behavior, sessions, operations, workflows, or deployment behavior. Warn the user if `.flue-source` does not exist before implementing Flue integration behavior.

## Implementation Rules

- Keep HTTP request and WebSocket event boundaries explicit and typed.
- Prefer discriminated unions for runtime events and state.
- Validate untrusted JSON before dispatching runtime actions.
- Do not use raw `console`; write intentional diagnostics to stderr or structured events.
- Keep custom Kira protocol records under an `app:*` type prefix.
- Keep Flue runtime activity under `flue:*` event or route names.
- Fail fast on malformed input with structured JSON errors.
