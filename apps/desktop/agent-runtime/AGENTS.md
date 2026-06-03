# Agent Runtime Instructions

This package hosts Kira's desktop agent runtime process.

## Ownership

- Package name: `@kira/agent-runtime`
- Runtime: Bun + TypeScript
- Owner: `apps/desktop/`
- Purpose: host the Pi SDK runtime behind a JSONL process boundary managed by Tauri.

Keep this package focused on agent runtime behavior. Do not turn it into a shared utility package.

## Architecture Boundary

- Rust/Tauri owns process supervision, app lifecycle integration, and writes to the Kira Persistence Store.
- The Kira Persistence Store is SQLite through the Rust backend. Do not write to Kira SQLite directly from this package.
- React should communicate through Tauri/Rust, not spawn this runtime directly.
- This runtime may emit Pi-compatible JSONL events and Kira `app:*` events for Rust to persist or forward.

Relevant Kira docs:

- `../../../AGENTS.md`
- `../../../docs/domain-language.md`
- `../../../docs/adr/0001-rust-owned-sqlite-persistence-store.md`
- `../../../docs/adr/0002-monorepo-hosted-admin-boundary.md`

## Pi Source Reference

Use the published `@earendil-works/pi-coding-agent` package as the dependency. Use the local Pi checkout as the source reference when changing SDK integration behavior:

- Pi source root: `C:/Users/BrandonRaphaelValent/Workspaces/.pi-source/`
- SDK docs: `C:/Users/BrandonRaphaelValent/Workspaces/.pi-source/packages/coding-agent/docs/sdk.md`
- RPC docs: `C:/Users/BrandonRaphaelValent/Workspaces/.pi-source/packages/coding-agent/docs/rpc.md`
- RPC mode source: `C:/Users/BrandonRaphaelValent/Workspaces/.pi-source/packages/coding-agent/src/modes/rpc/`
- Agent session/runtime source: `C:/Users/BrandonRaphaelValent/Workspaces/.pi-source/packages/coding-agent/src/core/`
- SDK examples: `C:/Users/BrandonRaphaelValent/Workspaces/.pi-source/packages/coding-agent/examples/sdk/`

Warn the user if .pi-source does not exist and do not proceed!

## Implementation Rules

- Keep protocol boundaries explicit and typed.
- Prefer discriminated unions for inbound commands and outbound events.
- Validate untrusted JSON before dispatching runtime actions.
- Write JSONL records with exactly one JSON object per line.
- Do not use `console` for protocol output; write to `stdout`/`stderr` intentionally.
- Keep custom Kira protocol records under an `app:*` type prefix.
- Fail fast on malformed input; emit a structured error record before exiting when possible.
