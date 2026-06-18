export function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} must be set.`);
  }
  return value;
}

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

export function readRuntimeToken(): string {
  return readRequiredEnv("KIRA_AGENT_RUNTIME_TOKEN");
}

export function readProjectPath(): string {
  return readRequiredEnv("KIRA_AGENT_PROJECT_PATH");
}

export function readPiDataDir(): string {
  return readRequiredEnv("KIRA_AGENT_PI_DATA_DIR");
}
