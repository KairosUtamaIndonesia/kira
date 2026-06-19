# Implementation Plan: Agent Pi → Tauri v2 Sidecar

## Overview

Convert the agent-pi bundled binary from a `bundle.resources` entry (manually resolved at runtime via `_up_` path probing) to a proper Tauri v2 sidecar declared via `bundle.externalBin`. Dev mode stays unchanged — `bun run dev` from the agent-pi directory for hot-reload. Only the production/Built path switches to the shell-plugin sidecar API.

## Motivation

- **Eliminate `_up_` path probing** — the fragile manual path resolution for bundled resources is replaced by Tauri's built-in sidecar binary resolution.
- **Std pattern** — sidecar is the documented Tauri approach for shipping companion binaries.
- **Process lifecycle** — the shell plugin manages kill-on-drop and console-window hiding automatically.

## Architecture Decisions

- **Dev mode unchanged** — `Command::new("bun").arg("run").arg("dev")` stays. Recompiling the compiled binary on every frontend change invalidates hot-reload.
- **Enum-based process handle** — `AppAgentRuntime.process` becomes an enum over `tokio::process::Child` (dev) and `CommandChild` (sidecar) rather than introducing trait objects or unifying on one type.
- **Binary naming** — follows `kira-agent-pi-{target-triple}{ext}` per Tauri sidecar convention. The `beforeBuildCommand` copies the compiled binary with the correct triple suffix.
- **`bundle.resources` trimmed** — the `kira-agent-pi*` glob leaves `bundle.resources`; `package.json` stays as a resource (used by the binary at runtime to read its own metadata).

## Task List

### Phase 1: Foundation

#### Task 1: Add `tauri-plugin-shell` dependency

**Description:** Add the shell plugin crate and register it in the Tauri plugin chain.

**Acceptance criteria:**

- [ ] `tauri-plugin-shell` added to `Cargo.toml` dependencies
- [ ] Plugin initialized in `lib.rs` via `.plugin(tauri_plugin_shell::init())`
- [ ] `shell:default` or appropriate sidecar permission added to `capabilities/default.json`

**Verification:**

- [ ] `bun run check:rust` passes (cargo check)
- [ ] `cargo metadata` shows the new dependency

**Dependencies:** None

**Files likely touched:**

- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/capabilities/default.json`

**Estimated scope:** Small (2-3 files)

---

#### Task 2: Update `tauri.conf.json` for sidecar configuration

**Description:** Declare the sidecar in `bundle.externalBin` and remove the agent-pi binary from `bundle.resources`.

**Acceptance criteria:**

- [ ] `bundle.externalBin` set to `["binaries/kira-agent-pi"]` (Tauri appends the target triple suffix automatically at runtime)
- [ ] `"../agent-pi/dist/kira-agent-pi*"` removed from `bundle.resources` array
- [ ] `"../agent-pi/dist/package.json"` stays in resources

**Verification:**

- [ ] `tauri.conf.json` is valid JSON
- [ ] Schema validates (no Tauri build warnings about unknown keys)

**Dependencies:** None (can parallelize with Task 1)

**Files likely touched:**

- `apps/desktop/src-tauri/tauri.conf.json`

**Estimated scope:** Small (1 file)

---

#### Task 3: Create binaries directory and update build orchestration

**Description:** Create `src-tauri/binaries/` directory, add a `.gitignore` for its contents (generated artifacts), and update `beforeBuildCommand` to copy the compiled binary with the target-triple suffix.

**Acceptance criteria:**

- [ ] `apps/desktop/src-tauri/binaries/` directory exists
- [ ] `.gitignore` in binaries dir ignores all files (`*`) but tracks the dir via `.gitkeep`
- [ ] `beforeBuildCommand` compiles agent-pi, copies binary to `binaries/kira-agent-pi-{target-triple}{ext}`, then builds frontend
- [ ] The copy handles `.exe` suffix on Windows correctly

**Verification:**

- [ ] `bun run tauri build` (dry run or full) produces the binary at the expected path
- [ ] `git status` shows only intended files

**Dependencies:** None (can parallelize with Tasks 1-2)

**Files likely touched:**

- `apps/desktop/src-tauri/tauri.conf.json` (update `beforeBuildCommand`)
- `apps/desktop/src-tauri/binaries/.gitignore` (create)
- `apps/desktop/src-tauri/binaries/.gitkeep` (create — or just add dir to git)

**Estimated scope:** Small (2-3 files)

---

### Phase 2: Core Rust Changes

#### Task 4: Update `agent_runtime.rs` to use sidecar API for Built mode

**Description:** Thread `tauri::AppHandle` into `start_app_runtime`, replace the Built-mode spawn with `app_handle.shell().sidecar("kira-agent-pi")`, and change `AppAgentRuntime.process` to an enum supporting both `tokio::process::Child` and `tauri_plugin_shell::process::CommandChild`.

**Acceptance criteria:**

- [ ] `start_agent_runtime` accepts `app: tauri::AppHandle` and passes it to `start_app_runtime`
- [ ] `start_app_runtime` receives `app_handle: tauri::AppHandle` parameter
- [ ] Built mode spawns via `app_handle.shell().sidecar("kira-agent-pi")` with `--port` arg
- [ ] Dev mode still uses `Command::new("bun").arg("run").arg("dev")`
- [ ] `AppAgentRuntime.process` is an enum: `ProcessHandle::Child(tokio::process::Child)` (dev) | `ProcessHandle::CommandChild(CommandChild)` (sidecar)
- [ ] `shutdown()` handles both variants (`.start_kill()` for Child, `.kill()` for CommandChild)
- [ ] `hide_console_window` still applied to dev-mode command but not to sidecar (shell plugin handles it)
- [ ] `kill_on_drop(true)` still set for dev-mode command (sidecar handles this via plugin)

**Verification:**

- [ ] `bun run check:rust` passes
- [ ] `cargo clippy --all-targets --all-features` passes (or noted exceptions documented)

**Dependencies:** Task 1 (shell plugin must exist), Task 2 (externalBin declared)

**Files likely touched:**

- `apps/desktop/src-tauri/src/agent_runtime.rs`

**Estimated scope:** Medium (1 file, ~40-60 lines changed — struct, spawn branches, shutdown)

---

#### Task 5: Remove production-only manual path resolution

**Description:** Delete `agent_pi_binary_path()` and the `RuntimeBinaryMissing` error variant. The `RuntimeDirectoryMissing` variant stays for dev mode.

**Acceptance criteria:**

- [ ] `agent_pi_binary_path()` function removed
- [ ] `AgentRuntimeError::RuntimeBinaryMissing` variant removed
- [ ] `_up_` path probing strings removed from file
- [ ] Any remaining dead code referencing the production path search is cleaned up

**Verification:**

- [ ] `bun run check:rust` passes
- [ ] No dead code warnings for the removed items

**Dependencies:** Task 4 (the code being removed is replaced by sidecar API)

**Files likely touched:**

- `apps/desktop/src-tauri/src/agent_runtime.rs`

**Estimated scope:** Small (1 file, remove ~30 lines)

---

### Phase 3: Verification

#### Task 6: Dev-mode smoke test

**Description:** Verify the agent runtime starts correctly in dev mode.

**Acceptance criteria:**

- [ ] `bun run tauri dev` starts without errors
- [ ] Agent runtime health check passes (the dev `bun run` server responds on `/health`)
- [ ] Agent thread commands work end-to-end (title generation, commit messages)

**Verification:**

- [ ] Manual: launch `bun run tauri dev`, confirm agent-pi starts
- [ ] Tauri command calls succeed from frontend

**Dependencies:** Tasks 4, 5

**Estimated scope:** Verification only

---

#### Task 7: Production build test

**Description:** Build the app bundle and verify the sidecar is included and resolved correctly.

**Acceptance criteria:**

- [ ] `bun run tauri build` succeeds
- [ ] The built bundle contains the sidecar binary (check `target/release/bundle/` contents)
- [ ] Sidecar path resolves without falling back to `_up_` probing (that code is gone)

**Verification:**

- [ ] `bun run tauri build` exits 0
- [ ] Inspect bundle output for the sidecar file

**Dependencies:** All prior tasks

**Estimated scope:** Verification only

---

#### Task 8: Rust tests pass

**Description:** Run existing Rust unit tests to confirm nothing regressed.

**Acceptance criteria:**

- [ ] `bun run test:rust` passes

**Verification:**

- [ ] `cargo test` in `apps/desktop/src-tauri/` exits 0

**Dependencies:** Tasks 4, 5

**Estimated scope:** Verification only

---

## Risks and Mitigations

| Risk                                                                                            | Impact                                   | Mitigation                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beforeBuildCommand` working directory unknown                                                  | Can break CI/local builds                | Verify Tauri v2 runs `beforeBuildCommand` from the app root (`apps/desktop/`). Document assumption. If wrong, adjust path to be relative to `src-tauri/`. |
| Target-triple naming mismatch                                                                   | Sidecar not found at runtime             | Use `$TARGET_TRIPLE` env var (set by Tauri CLI during build) in the copy command. Test on all three platforms.                                            |
| `CommandChild` API differs from `tokio::process::Child` in edge cases (`wait`, signal handling) | Low — both support `kill()` and `wait()` | Wrap both variants in `ProcessHandle` enum with a unified `kill()` method. The shutdown code already only calls `start_kill()`.                           |
| Build command becomes fragile/hard to read                                                      | Low                                      | Extract binary copy into a small script (`scripts/copy-agent-pi-sidecar.ts` or a simple shell script)                                                     |

## Open Questions

1. **Does Tauri v2 set `TARGET_TRIPLE` env var during `beforeBuildCommand`?** If not, we need to detect it via `rustc -vV` inside the command.
2. **`beforeBuildCommand` working directory** — confirm Tauri runs the command from `apps/desktop/` (the `package.json` parent) via inspection or a test run.

## Parallelization

- Tasks 1, 2, 3 are independent and can run in parallel.
- Tasks 4, 5 depend on 1, 2, 3 and are sequential (4 → 5).
- Tasks 6, 7, 8 are verification and depend on 4, 5.
