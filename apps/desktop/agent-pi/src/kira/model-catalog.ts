type ModelConfig = {
  label: string;
  upstreamModelId: string;
  providerId: string;
  providerBaseUrl: string;
  contextWindow: number;
  maxOutputTokens: number;
  maxInputTokens?: number;
  capabilities?: {
    reasoning?: boolean;
    thinking?: boolean;
    tool_calling?: boolean;
    vision?: boolean;
  };
  isDefault: boolean;
  apiKey?: string;
};

type ModelCatalog = {
  models: ModelConfig[];
};

let cachedCatalog: ModelCatalog | undefined;

function readBackendUrl(): string {
  const url = process.env.KIRA_AGENT_BACKEND_URL;
  if (url === undefined || url.length === 0) {
    throw new Error("KIRA_AGENT_BACKEND_URL is not set");
  }
  return url;
}

/** Fetch the model catalog from the Rust backend and cache it in memory. */
async function fetchAndCacheCatalog(): Promise<void> {
  const backendUrl = readBackendUrl();
  const response = await fetch(`${backendUrl}/api/org/models`);
  if (!response.ok) {
    throw new Error(`Failed to fetch model catalog: ${response.status} ${response.statusText}`);
  }

  const catalog: ModelCatalog = await response.json();

  if (!Array.isArray(catalog.models)) {
    throw new Error("Model catalog has an invalid structure");
  }

  cachedCatalog = catalog;
}

function getDefaultModel(): ModelConfig {
  if (cachedCatalog === undefined) {
    throw new Error("Model catalog not loaded. Call fetchAndCacheCatalog first.");
  }

  const defaultModel = cachedCatalog.models.find((model) => model.isDefault);
  if (defaultModel === undefined) {
    throw new Error("No default model configured in organization catalog");
  }
  return defaultModel;
}

function getModelCatalog(): ModelCatalog {
  if (cachedCatalog === undefined) {
    throw new Error("Model catalog not loaded. Call fetchAndCacheCatalog first.");
  }
  return cachedCatalog;
}

export { fetchAndCacheCatalog, getDefaultModel, getModelCatalog };
export type { ModelCatalog, ModelConfig };
