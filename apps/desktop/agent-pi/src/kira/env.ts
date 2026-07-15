export function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  if (value.trim().length === 0) {
    throw new Error(`${name} must be non-empty when set.`);
  }
  return value;
}

export function readPiDataDir(): string {
  return (
    process.env.KIRA_AGENT_PI_DATA_DIR ??
    (process.platform === "win32"
      ? `${process.env.APPDATA}/Kira`
      : `${process.env.HOME}/.config/kira`)
  );
}

/**
 * Reads the optional primary shell path configured for Agent Pi.
 *
 * Set by the Tauri backend via `KIRA_AGENT_SHELL_PATH` (production) or by
 * the developer in their environment (dev via `tauri.ts`).
 *
 * Returns `undefined` when unset, allowing the consumer to fall back to
 * the Pi SDK / system default.
 */
export function readAgentShellPath(): string | undefined {
  return readOptionalEnv("KIRA_AGENT_SHELL_PATH");
}
