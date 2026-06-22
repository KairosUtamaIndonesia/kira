# Bun-Sourced Agent Runtime

## Problem Statement

How might we ship the embedded agent runtime (`agent-pi`) without maintaining a separate compilation step, sidecar binary signing, and Tauri `externalBin` infrastructure — for an in-house desktop app with no code-signing workflow?

## Recommended Direction

Ship the agent-pi as a Tauri **resource** (compiled JS via `bun build --target=bun`) and run it via the user's own Bun installation. Replace the current `bun compile → sidecar → externalBin` pipeline with `bun run <resource>/server.mjs`.

The Rust code already has a `Dev` launch mode that does essentially this (`bun run dev`). Generalize it: add a `BunRuntime` variant alongside `Dev` and `Built` that resolves the JS bundle from the resource directory and spawns `bun` with it. Spawn uses a probed or user-configured full path, never a bare `Command::new("bun")`.

The build becomes two steps (`bun build` the JS + bundle as resource) instead of compile+copy+sidecar-placeholder.

Bun installation is handled with a guided in-app flow: on first launch when no Bun is found, show a dialog offering to run the official install script (`curl -fsSL https://bun.sh/install | bash` on macOS/Linux, appropriate PowerShell command on Windows). After the script completes, re-probe the well-known location (`~/.bun/bin/bun`). On success, proceed. On failure, offer a manual path override.

## Key Assumptions to Validate

- [ ] **`bun build --target=bun` output is relocatable** — no absolute paths or dynamic `require()` in the bundle. Test by moving the output dir and running it.
- [ ] **Resources with `.mjs` extension don't trigger Tauri bundler warnings** — or use a neutral extension mapped at spawn time.
- [ ] **Startup latency** (Bun parsing + module loading) is acceptable — measure from spawn to `/healthz` responding; target <500ms.
- [ ] **`curl | bash` install script completes without user interaction** in the spawn context (no TTY required for install script).
- [ ] **Re-probe after install** reliably catches `~/.bun/bin/bun` on all supported platforms.

## MVP Scope

**In:**
- New `AgentRuntimeLaunchMode::Bun` variant in `agent_runtime.rs`
- `start_app_runtime` spawns `bun run <resource-path>/server.mjs` via resolved path
- Resource config in `tauri.conf.json`: bundle `agent-pi/dist/` → `agent-runtime/`
- Bun path probing: `~/.bun/bin/bun`, `/opt/homebrew/bin/bun`, `/usr/local/bin/bun`, `PATH`
- SQLite setting `agentRuntime.bunPath` for user-configured override (same pattern as `agent_shell_path`)
- In-app guided install flow: detect missing Bun → dialog → run install script → re-probe → proceed or fallback to manual path
- Remove `externalBin`, `build.rs` placeholder, `copy-agent-pi-sidecar.ts`, `copy-binary-assets.ts`, and the `compile` script

**Out:**
- No system daemon / service installer
- No app-downloaded Bun binary (user's own installation)
- No in-process JS engine (rusty_v8 / boa)
- No cloud-hosted runtime

## Bun Path Discovery (Critical Design Element)

**Risk:** macOS apps launched from Finder/Dock do NOT inherit the user's shell PATH. `Command::new("bun")` fails silently. The production spawn must use a fully resolved path.

**Strategy — probe then override:**
1. At startup, probe known locations in order: `~/.bun/bin/bun`, `/opt/homebrew/bin/bun`, `/usr/local/bin/bun`, then system `PATH`.
2. If a probe succeeds, cache the resolved path in memory for the app session.
3. If the user has configured `agentRuntime.bunPath` in settings, that takes priority over probes (mirrors the `agent_shell_path` pattern in `settings.rs`).
4. If no probe finds Bun → trigger the guided install flow.

**Guided install flow:**
1. Show dialog: *"Kira needs Bun to run the agent — install it now?"*
2. On accept, spawn the official install script as a subprocess (no TTY needed):
   - macOS/Linux: `/bin/bash -c "curl -fsSL https://bun.sh/install | bash"`
   - Windows: PowerShell `irm bun.sh/install.ps1 | iex`
3. Stream script output to a dialog/progress indicator.
4. On completion, re-probe known locations. `~/.bun/bin/bun` should now exist.
5. On success → store resolved path, proceed.
6. On failure → show error + link to bun.sh + offer manual path picker (wired to the `agentRuntime.bunPath` setting).

The install script is idempotent, so re-running is safe.

**Staleness:** On every app launch, verify the resolved path still exists. If not, re-probe and optionally re-trigger install flow.

## Rejected Alternative: App-Managed Bun

Download a pinned Bun binary from GitHub releases into the app data dir on first launch. This kills the PATH-probe problem and version drift cleanly.

**Rejected because:** user prefers user-installed Bun, which avoids the ~40MB download and keeps Bun as a known system tool that can be used outside the app.

## Not Doing (and Why)

- **Bundling portable Bun inside the .app** — any Mach-O in the bundle must be resigned with our Developer ID; defeats the purpose.
- **Cloud-hosted runtime** — adds network dependency, offline breaks; solves a non-problem for an in-house tool.
- **In-process JS engine** — enormous engineering cost for zero user-facing benefit.
- **System service / launchd** — overkill; app-open lifecycle matches current contract.
- **Compiled sidecar binary** — what we're replacing. Dead code after migration.

## Open Questions

- **Minimum Bun version**: Do we check `bun --version` and enforce a floor? Or trust the install script to deliver a current enough version?
- **Windows install script**: Does `irm bun.sh/install.ps1 | iex` work non-interactively from a Rust `Command::new("powershell")`? Needs verification.
- **Build script**: Inline into Tauri's `beforeBuildCommand` or keep as a separate `bun run build` step in agent-pi's `package.json`?
- **Migration path**: Users upgrading from a sidecar-based install. Old code path kept until first successful Bun launch, then hard-switch?
