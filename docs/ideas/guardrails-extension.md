# Guardrails Extension

## Problem Statement

How might we prevent the Kira desktop agent from accidentally reading secrets, modifying protected files, or running destructive shell commands — without requiring any user configuration out of the box?

## Recommended Direction

Build a single Pi extension (`guardrails`) with two handlers — **file policies** and **command gate** — following the memory extension's architecture exactly. The extension registers a `tool_call` hook on the Pi `ExtensionAPI`, checks every file tool call and bash command against compiled rules, and either allows, blocks, or prompts the user via `ToolUiBroker` in-chat UI.

Config lives in SQLite via a new `guardrails` section in app settings (`settings.rs`), with a new migration. Defaults are permissive: protect `.env`, private keys, and credential files; auto-deny `rm -rf`, `sudo`, `chmod -R 777`, and other structurally dangerous commands. Everything else passes through. Users can tighten rules via a settings UI, but zero configuration is required for the extension to be useful.

The extension is a single directory under `agent-pi/src/kira/extensions/guardrails/` with handler modules for each concern, a shared config loader, and compiled rule objects — mirroring the memory extension's `handlers/`, `config.ts`, `store/` structure.

Reference implementation: [pi-guardrails](../../references/pi-guardrails/) — port the core matching logic and dangerous command AST parsing (`@aliou/sh`), adapt the extension wiring to Kira's patterns.

## Key Assumptions to Validate

- [ ] **Multiple extensions can coexist on `tool_call` hooks.** Spike: register a second no-op extension alongside memory that logs every `tool_call` event. Verify both hooks fire and neither swallows events. Test in `agent-session-host.ts` with `extensionFactories: [memoryExtension, noopGuardrails]`.
- [ ] **`ToolUiBroker` can serve hook-initiated prompts that block tool execution.** Spike: from a `tool_call` hook, call the broker's prompt mechanism and verify the tool call waits for user input before proceeding. If this doesn't work, fall back to Tauri dialog plugin (`tauri-plugin-dialog`, already a dependency).
- [ ] **`@aliou/sh` shell parser works in Bun.** Install the dependency, write a quick test that parses `rm -rf /tmp/foo && sudo apt install bar` into an AST. If it fails, fall back to regex-only command matching (weaker but functional).
- [ ] **SQLite config loads before the first `tool_call`.** Verify that `settings.rs` reads are fast enough that there's no unprotected race window. If there is, load config synchronously during `buildAgentSession()` or default to "block" until config is ready.

## MVP Scope

**In:**

- File protection policies with hardcoded defaults: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`, `.git/config`, `.netrc`, `.npmrc`
- Protection levels: `noAccess` (block read+write), `readOnly` (block write/edit)
- Dangerous command gate with hardcoded defaults: `rm -rf`, `sudo`, `chmod -R 777`, `chown -R`, `dd of=`, `mkfs`, `shred`, `wipefs`, `fdisk`, container escape patterns (`--privileged`, `--pid=host`)
- Structural shell parsing via `@aliou/sh` for built-in matchers, substring/regex fallback for user-configured patterns
- In-chat allow/deny prompt via ToolUiBroker when a risky action is detected
- "Allow once" and "Allow for session" grant options
- Session-scoped grant memory (allowing `rm -rf /tmp/build-*` once doesn't allow it next session)
- SQLite config with a migration adding a `guardrails_settings` table
- Default config loaded without any user action — extension is active on first run

**Out (for now):**

- Settings UI / onboarding wizard
- Path access control (workspace boundary enforcement)
- Config JSON export/import
- Audit log / history of blocked actions
- Per-project config overrides

## Not Doing (and Why)

- **Path access control** — The least-used feature in pi-guardrails. The agent already runs with the project as cwd. Outside-workspace access is rare and less dangerous than the two features we are building. Add it later if users ask.
- **Native Tauri dialogs for prompts** — In-chat UI via ToolUiBroker is more consistent with the existing agent experience. Tauri dialogs would feel jarring mid-conversation. Revisit if the ToolUiBroker spike fails.
- **Content-based secret scanning** — Scanning file contents for API keys before allowing reads is the "expert" approach but has high false positives and performance cost. Filename-based protection catches 80% of cases. Content scanning is a v2 enhancement.
- **Org-scoped policies** — Premature. Kira's org features are still maturing. Guardrails should work for individual users first. Org scoping is a natural extension once the base is solid.
- **Audit log / action history** — Valuable for the "observe first, configure later" pattern (variation 3), but it's a separate feature. The MVP focuses on prevention, not observation.
- **Custom user-configured rules in v1** — Hardcoded defaults cover the critical cases. Adding a rule editor UI is significant work. Users who need custom rules can edit the SQLite config directly or wait for the settings UI.

## Open Questions

- **Hook execution order:** When both memory and guardrails extensions register `tool_call` hooks, does the Pi SDK guarantee execution order? If guardrails runs after memory, a dangerous tool call might already have side effects. Need to check if there's a priority mechanism or if hooks can block downstream handlers.
- **Block reason prompting:** When guardrails blocks a tool call with a reason like "this file is protected," does the Pi agent actually respect it and change behavior, or does it retry? The block reason needs to be phrased as an instruction to the agent, not just a rejection. Study how pi-guardrails formats block reasons for the agent's system prompt.
- **Performance impact:** Every tool call goes through the guardrails hook. If the rule compilation or matching is slow, it adds latency to every agent action. Benchmark: the hook should add < 1ms per tool call for the default rule set.
- **Extension lifecycle:** Does the extension get a `session_end` or cleanup hook? Session-scoped grants need to be cleared when the session ends. Memory extension handles this — follow the same pattern.
