/**
 * Agent Pi settings helper — creates the Pi SettingsManager with the
 * configured primary shell path bridged from the Desktop settings store.
 *
 * In production the Tauri backend reads the primary `terminal.shellPath`
 * from SQLite and sets `KIRA_AGENT_SHELL_PATH` on the sidecar process.
 * In dev mode the developer sets the env var manually (passthrough in
 * `scripts/tauri.ts`).  Either way this module reads the env var and
 * produces an in-memory SettingsManager for `createAgentSession`.
 *
 * When unset, Pi retains its SDK/system default shell — no hidden fallback.
 */

import { SettingsManager } from "@earendil-works/pi-coding-agent";

import { readAgentShellPath } from "./env";

/**
 * Creates an in-memory `SettingsManager` with the optional primary shell
 * path applied.  Returns a plain `SettingsManager` — no file I/O, no
 * persistence.  Callers pass it directly to `createAgentSession`.
 */
export function createAgentSettings(): SettingsManager {
  const shellPath = readAgentShellPath();
  return SettingsManager.inMemory(shellPath !== undefined ? { shellPath } : undefined);
}
