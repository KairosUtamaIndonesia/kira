type ModelConfig = {
  label: string;
  upstreamModelId: string;
  providerId: string;
  providerBaseUrl: string;
  contextWindow: number;
  maxOutputTokens: number;
  isDefault: boolean;
};

type ModelCatalog = {
  models: ModelConfig[];
};

function parseModelCatalog(): ModelCatalog {
  const raw = process.env.KIRA_AGENT_MODEL_CATALOG;
  if (raw === undefined || raw.length === 0) {
    throw new Error("KIRA_AGENT_MODEL_CATALOG is not set");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("KIRA_AGENT_MODEL_CATALOG is not valid JSON");
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "models" in parsed &&
    Array.isArray((parsed as Record<string, unknown>).models)
  ) {
    return parsed as ModelCatalog;
  }

  throw new Error("KIRA_AGENT_MODEL_CATALOG has an invalid catalog structure");
}

const modelCatalog = parseModelCatalog();

function getDefaultModel(): ModelConfig {
  const defaultModel = modelCatalog.models.find((model) => model.isDefault);
  if (defaultModel === undefined) {
    throw new Error("No default model configured in organization catalog");
  }
  return defaultModel;
}

export { getDefaultModel, modelCatalog };
export type { ModelCatalog, ModelConfig };
