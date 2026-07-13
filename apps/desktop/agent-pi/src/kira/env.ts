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
