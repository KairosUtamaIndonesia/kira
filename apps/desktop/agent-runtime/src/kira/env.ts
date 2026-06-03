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

export const KIRA_AGENT_MODEL = "cx/gpt-5.5";
export const KIRA_AGENT_PROVIDER_ID = "cx";
export const KIRA_AGENT_PROVIDER_BASE_URL = "https://router.kira.internal.kairos-it.com";

export function readAgentProviderApiKey(): string | undefined {
  return readOptionalEnv("KIRA_AGENT_PROVIDER_API_KEY");
}
