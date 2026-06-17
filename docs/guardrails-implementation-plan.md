# Implementation Plan: Guardrails Extension

## Overview

Build a Pi extension (`guardrails`) with two handlers — file protection policies and dangerous command gate — following the memory extension's architecture. The extension hooks into `tool_call` events via `ExtensionAPI.on()`, checks every file tool call and bash command against compiled rules, and either allows, blocks, or prompts the user via `ctx.ui.custom()`.

Config is stored in SQLite (`app_settings` key-value table), serialized as JSON, and passed to agent-pi as `KIRA_AGENT_GUARDRAILS_CONFIG` env var at process spawn. No migration needed — the existing `app_settings` table supports arbitrary key-value pairs.

Reference implementation: `~/Workspaces/references/pi-guardrails/` — port core matching logic and dangerous command AST parsing, adapt extension wiring to Kira's patterns.

## Architecture Decisions

- **Single extension, two handlers** (not three separate extensions like pi-guardrails). Simpler wiring, shared config, one `tool_call` hook that dispatches to the right handler based on tool name.
- **Config via env var** (not Hono route or JSON file). Settings are immutable per agent-pi process lifetime. Config changes require agent-pi restart. This matches how `KIRA_AGENT_SHELL_PATH` and `KIRA_AGENT_MODEL_CATALOG` already work.
- **`ctx.ui` for prompts** (not ToolUiBroker). `ctx.ui.custom<T>()` is the SDK's built-in mechanism for interactive prompts in hooks. Confirmed working in Kira's skills-command handler. Falls back to `ctx.ui.select()` when custom UI is unavailable (RPC mode).
- **`@aliou/sh` for shell parsing** (dependency from pi-guardrails). Structural matching catches `rm -rf`, `rm -r -f`, `rm --recursive --force` in one matcher. Falls back to substring/regex if the dependency doesn't work in Bun.
- **Session-scoped grants in memory** (not persisted). "Allow once" and "Allow for session" grants live in a `Map` cleared on `session_shutdown`. No persistence across sessions — security degrades if grants survive.
- **Extension registered AFTER memory** in `extensionFactories`. Guardrails should run after memory's `tool_call` hooks (if any) so it has final say on blocking.

## Dependency Graph

```
Task 1: Types & config (foundation)
    │
    ├── Task 2: File policies handler
    │       │
    │       └── Task 3: Command gate handler
    │               │
    │               └── Task 4: Extension entry point + wiring
    │                       │
    │                       └── Task 5: Settings integration (Rust + env var)
    │                               │
    │                               └── Task 6: Smoke test & verification
```

## Task List

### Phase 1: Foundation

#### Task 1: Types, config loader, and extension skeleton

**Description:** Create the guardrails extension directory structure with TypeScript types, a config loader that reads from the env var, hardcoded defaults, and a skeleton extension factory that registers a no-op `tool_call` hook.

**Acceptance criteria:**

- [ ] `extensions/guardrails/types.ts` defines `GuardrailsConfig`, `FilePolicy`, `Protection`, `DangerousPattern`, `GuardrailsState`
- [ ] `extensions/guardrails/config.ts` loads config from `KIRA_AGENT_GUARDRAILS_CONFIG` env var (JSON), merges with hardcoded defaults, falls back to defaults-only if env var is missing
- [ ] `extensions/guardrails/defaults.ts` contains hardcoded default file policies (`.env`, `*.pem`, `*.key`, etc.) and dangerous command patterns (`rm -rf`, `sudo`, etc.)
- [ ] `extensions/guardrails/index.ts` exports a default `guardrailsExtension(pi: ExtensionAPI)` factory that registers `tool_call` and `session_shutdown` hooks (no-op bodies for now)
- [ ] Compiles with `bun run build` (or `tsc --noEmit` in the agent-pi package)

**Verification:**

- [ ] `bun run typecheck` passes in `apps/desktop/agent-pi/`
- [ ] Extension factory can be imported without errors

**Dependencies:** None

**Files likely touched:**

- `apps/desktop/agent-pi/src/kira/extensions/guardrails/types.ts` (new)
- `apps/desktop/agent-pi/src/kira/extensions/guardrails/config.ts` (new)
- `apps/desktop/agent-pi/src/kira/extensions/guardrails/defaults.ts` (new)
- `apps/desktop/agent-pi/src/kira/extensions/guardrails/index.ts` (new)

**Estimated scope:** M (4 new files)

---

### Phase 2: File Policies Handler

#### Task 2: File protection policies handler

**Description:** Implement the file policies handler that intercepts file tool calls (`read`, `write`, `edit`), checks the file path against compiled glob patterns, and returns a block result or prompts the user.

**Acceptance criteria:**

- [ ] `extensions/guardrails/handlers/file-policies.ts` exports `checkFilePolicy(toolName, filePath, config, grants)` that returns `{ action: "allow" } | { action: "block", reason: string } | { action: "prompt", protection: Protection }`
- [ ] Glob patterns compile to matchers at config load time (not per-call)
- [ ] `noAccess` protection blocks both read and write tool calls
- [ ] `readOnly` protection blocks write/edit but allows read
- [ ] Matching uses `picomatch` or equivalent (already available in the pi-guardrails dependency tree) for glob patterns
- [ ] Handler checks grants before rules (session-scoped "allow" bypasses the block)
- [ ] Block reasons are phrased as agent instructions: "The file `.env` is protected by guardrails policy. Do not attempt to read or modify this file."

**Verification:**

- [ ] Unit test: `.env` file → blocked for read and write
- [ ] Unit test: `*.pem` file → blocked for read and write
- [ ] Unit test: `src/index.ts` → allowed
- [ ] Unit test: `readOnly` policy blocks write but allows read
- [ ] Unit test: granted file bypasses block

**Dependencies:** Task 1 (types, config)

**Files likely touched:**

- `apps/desktop/agent-pi/src/kira/extensions/guardrails/handlers/file-policies.ts` (new)
- `apps/desktop/agent-pi/src/kira/extensions/guardrails/grants.ts` (new)
- `apps/desktop/agent-pi/src/kira/extensions/guardrails/patterns.ts` (new — glob compilation)

**Estimated scope:** M (3 new files)

---

### Phase 3: Command Gate Handler

#### Task 3: Dangerous command gate handler

**Description:** Implement the command gate handler that intercepts `bash` tool calls, parses the command using `@aliou/sh` AST matching, and blocks or prompts for dangerous commands.

**Acceptance criteria:**

- [ ] `extensions/guardrails/handlers/command-gate.ts` exports `checkDangerousCommand(command, config, grants)` that returns `{ action: "allow" } | { action: "block", reason, match } | { action: "prompt", match }`
- [ ] Built-in structural matchers: `rmMatcher`, `sudoMatcher`, `chmodMatcher`, `chownMatcher`, `ddMatcher`, `mkfsMatcher`, `shredMatcher`, `wipefsMatcher`, `fdiskMatcher`, `containerMatcher` (ported from pi-guardrails `src/core/commands/dangerous.ts`)
- [ ] Structural matchers catch variant forms: `rm -rf`, `rm -r -f`, `rm --recursive --force`
- [ ] Substring/regex fallback for user-configured patterns
- [ ] Handler checks grants before rules (session-scoped "allow" bypasses the block)
- [ ] Block reasons name the specific danger: "Command `rm -rf /tmp/build` matches dangerous pattern: recursive force delete"

**Verification:**

- [ ] Unit test: `rm -rf /tmp/foo` → blocked
- [ ] Unit test: `rm -r -f /tmp/foo` → blocked (variant form)
- [ ] Unit test: `sudo apt install foo` → blocked
- [ ] Unit test: `chmod -R 777 /var/www` → blocked
- [ ] Unit test: `ls -la` → allowed
- [ ] Unit test: `git status` → allowed
- [ ] Unit test: granted command bypasses block
- [ ] `@aliou/sh` parses successfully in Bun (if not, fall back to regex)

**Dependencies:** Task 1 (types, config), Task 2 (grants module)

**Files likely touched:**

- `apps/desktop/agent-pi/src/kira/extensions/guardrails/handlers/command-gate.ts` (new)
- `apps/desktop/agent-pi/src/kira/extensions/guardrails/matchers/` (new directory, one file per matcher category)

**Estimated scope:** L (5+ files, but mostly ported from reference)

---

### Checkpoint: After Tasks 1–3

- [ ] All types compile
- [ ] File policies handler works in isolation (unit tests pass)
- [ ] Command gate handler works in isolation (unit tests pass)
- [ ] `@aliou/sh` confirmed working in Bun (or fallback in place)

---

### Phase 4: Extension Wiring

#### Task 4: Extension entry point and agent-session-host wiring

**Description:** Wire the guardrails extension into the agent session. The `tool_call` hook dispatches to the correct handler based on tool name, calls `ctx.ui.custom()` for prompts, and returns `{ block: true, reason }` when needed. Register the extension in `agent-session-host.ts`.

**Acceptance criteria:**

- [ ] `extensions/guardrails/index.ts` `tool_call` hook dispatches:
  - `read`, `write`, `edit` → file policies handler
  - `bash` → command gate handler
  - All other tools → pass through
- [ ] Hook calls `ctx.ui.custom<T>()` for prompt actions, with fallback to `ctx.ui.select()` when `ctx.hasUI` is false
- [ ] Prompt component shows: tool name, what's being blocked, why, and three options: "Allow once", "Allow for session", "Deny"
- [ ] "Allow once" adds to in-memory grant map, "Allow for session" adds to session-scoped grant map
- [ ] `session_shutdown` hook clears all grants
- [ ] `agent-session-host.ts` adds `guardrailsExtension` to `extensionFactories` array after `memoryExtension`
- [ ] Extension loads without errors when `KIRA_AGENT_GUARDRAILS_CONFIG` is not set (uses defaults)

**Verification:**

- [ ] `bun run typecheck` passes
- [ ] Extension registers alongside memory extension without conflicts
- [ ] Manual test: agent tries to read `.env` → prompt appears → "Deny" → agent receives block reason
- [ ] Manual test: agent runs `rm -rf /tmp/test` → prompt appears → "Allow once" → command executes; next `rm -rf` in same session is re-prompted
- [ ] Manual test: agent reads `src/index.ts` → passes through without prompt

**Dependencies:** Tasks 1, 2, 3

**Files likely touched:**

- `apps/desktop/agent-pi/src/kira/extensions/guardrails/index.ts` (modify)
- `apps/desktop/agent-pi/src/kira/extensions/guardrails/handlers/prompt.ts` (new — UI component factory)
- `apps/desktop/agent-pi/src/kira/agent-session-host.ts` (modify — add to extensionFactories)

**Estimated scope:** M (1 modify, 2 new)

---

### Phase 5: Settings Integration

#### Task 5: Rust settings integration and env var passthrough

**Description:** Add guardrails config to the Rust settings layer and pass it to agent-pi as an env var at process spawn.

**Acceptance criteria:**

- [ ] `settings.rs` adds `GUARDRAILS_CONFIG_KEY` constant and getter/setter functions following the existing pattern (`app_setting_value`, `upsert_app_setting_in_transaction`)
- [ ] Input/output structs: `GuardrailsSettingsInput` (JSON string), `GuardrailsSettingsOutput` (JSON string)
- [ ] `#[tauri::command]` handlers: `guardrails_settings_get`, `guardrails_settings_update`
- [ ] Commands registered in `lib.rs` invoke_handler
- [ ] `start_app_runtime()` in `agent_runtime.rs` reads guardrails config from SQLite and passes as `KIRA_AGENT_GUARDRAILS_CONFIG` env var
- [ ] `env.ts` adds `readGuardrailsConfig()` that reads and parses the JSON env var, returns defaults if missing
- [ ] Guardrails extension's config loader calls `readGuardrailsConfig()`

**Verification:**

- [ ] `cargo check` passes
- [ ] `cargo clippy --all-targets --all-features -- -D warnings` passes
- [ ] `bun run typecheck` passes
- [ ] Guardrails config round-trips: Rust set → env var → TypeScript read → extension uses it

**Dependencies:** Task 4 (extension wiring)

**Files likely touched:**

- `apps/desktop/src-tauri/src/settings.rs` (modify)
- `apps/desktop/src-tauri/src/lib.rs` (modify — register commands)
- `apps/desktop/src-tauri/src/agent_runtime.rs` (modify — add env var)
- `apps/desktop/agent-pi/src/kira/env.ts` (modify)
- `apps/desktop/agent-pi/src/kira/extensions/guardrails/config.ts` (modify)

**Estimated scope:** M (5 files, all modifications)

---

### Checkpoint: After Tasks 4–5

- [ ] Full extension loads in a real agent session
- [ ] File policies block protected files
- [ ] Command gate blocks dangerous commands
- [ ] In-chat prompt appears and grants work
- [ ] Settings round-trip from SQLite to extension
- [ ] `bun run lint:all && bun run format:all:check && bun run check:rust` passes

---

### Phase 6: Verification & Polish

#### Task 6: End-to-end smoke test and edge cases

**Description:** Verify the full guardrails flow end-to-end in a real Tauri dev session. Test edge cases: empty config, malformed JSON, concurrent tool calls, rapid allow/deny.

**Acceptance criteria:**

- [ ] Agent session starts with guardrails active (no config → defaults applied)
- [ ] Agent tries to read `.env` → blocked with reason
- [ ] Agent tries to write `id_rsa` → blocked with reason
- [ ] Agent runs `rm -rf /tmp/test` → prompted, user denies → agent receives block reason and does not retry
- [ ] Agent runs `ls -la` → passes through without prompt
- [ ] Agent runs `git commit` → passes through without prompt
- [ ] "Allow for session" persists across multiple tool calls in the same session
- [ ] Session shutdown clears grants
- [ ] Malformed `KIRA_AGENT_GUARDRAILS_CONFIG` → falls back to defaults, logs warning
- [ ] Performance: guardrails hook adds < 5ms per tool call

**Verification:**

- [ ] Manual test in `bun run tauri dev` — full agent session with guardrails
- [ ] All unit tests pass
- [ ] `bun run check` passes (full project check)

**Dependencies:** Tasks 4, 5

**Files likely touched:** None (verification only)

**Estimated scope:** S (verification task)

---

### Checkpoint: Complete

- [ ] All acceptance criteria met
- [ ] Guardrails extension works end-to-end in a real agent session
- [ ] No regressions in existing memory extension
- [ ] All lint, format, and type checks pass
- [ ] Ready for review

## Risks and Mitigations

| Risk                                                                      | Impact | Mitigation                                                                                                               |
| ------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| `@aliou/sh` doesn't work in Bun                                           | Medium | Fall back to regex-only command matching. Weaker but functional. Test in Task 3.                                         |
| `ctx.ui.custom()` doesn't work in `tool_call` hooks in Kira's environment | High   | Fall back to `ctx.ui.select()` (confirmed working). If that fails too, fall back to Tauri dialog plugin. Test in Task 4. |
| Multiple extensions' `tool_call` hooks conflict                           | Low    | Guardrails runs after memory. First `block: true` wins. Memory doesn't block tool calls currently.                       |
| Config env var too large for shell                                        | Low    | Guardrails config is small (< 1KB JSON). Not a real risk.                                                                |
| Agent ignores block reason and retries                                    | Medium | Block reason must be phrased as an instruction, not just a rejection. Study pi-guardrails' reason formatting.            |
| Performance: glob matching on every tool call                             | Low    | Compile patterns once at config load time. Benchmark in Task 6.                                                          |

## Open Questions

- **Hook execution order:** Extensions run in `extensionFactories` array order. Register guardrails AFTER memory so it has final say. No priority mechanism exists — this is the only control.
- **`ctx.ui.custom()` component rendering:** Need to build a TUI component for the allow/deny prompt. Study `createPermissionGateConfirmComponent` from pi-guardrails and `SkillsManagerModal` from memory extension. The component receives `(tui, theme, keybindings, done)` and must call `done(result)`.
- **Block reason phrasing:** Study how pi-guardrails formats reasons. The reason is reported to the LLM, so it should instruct the agent to stop, not just describe what happened.
