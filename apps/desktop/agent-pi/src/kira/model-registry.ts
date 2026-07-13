/**
 * Model registry — registers cloud provider models via Pi's provider API.
 *
 * Fetches the model catalog from the Kira cloud API at startup.
 * Falls back to Pi's built-in models if the cloud API is unreachable.
 */

import type { Api } from "@earendil-works/pi-ai/compat";

import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

interface CloudModel {
  providerId: string;
  providerBaseUrl: string;
  apiKey?: string;
  api?: string;
  upstreamModelId: string;
  label: string;
  capabilities?: {
    reasoning?: boolean;
    vision?: boolean;
  };
  contextWindow?: number;
  maxOutputTokens?: number;
  isDefault?: boolean;
}

export const authStorage = AuthStorage.create();
export const modelRegistry = ModelRegistry.create(authStorage);

interface DefaultModelRef {
  providerId: string;
  modelId: string;
}

let defaultModelRef: DefaultModelRef | undefined;

/** Returns the model object from the registry for the cloud default model, if any. */
export function getDefaultModel(): { provider: string; id: string } | undefined {
  if (!defaultModelRef) return undefined;
  return { provider: defaultModelRef.providerId, id: defaultModelRef.modelId };
}

export async function registerProviderExtensions(): Promise<void> {
  const cloudUrl = process.env.KIRA_CLOUD_API_URL || process.env.KIRA_CLOUD_URL;
  const apiKey = process.env.KIRA_API_KEY;
  if (!cloudUrl || !apiKey) {
    throw new Error("KIRA_CLOUD_API_URL and KIRA_API_KEY must be set");
  }

  let rawModels: CloudModel[];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${cloudUrl}/api/desktop/models`, {
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`${res.status}`);
    const body: { models: CloudModel[] } = await res.json();
    rawModels = body.models;
  } catch (err) {
    throw new Error(`Failed to fetch models from cloud: ${(err as Error).message}`, { cause: err });
  }

  const byProvider = new Map<string, CloudModel[]>();
  for (const m of rawModels) {
    const list = byProvider.get(m.providerId) ?? [];
    list.push(m);
    byProvider.set(m.providerId, list);
  }

  if (byProvider.size === 0) {
    throw new Error("Cloud model catalog returned no providers");
  }

  for (const [providerId, models] of byProvider) {
    const first = models[0];

    // Register provider with Pi's native registry
    modelRegistry.registerProvider(providerId, {
      baseUrl: first.providerBaseUrl,
      apiKey: first.apiKey ?? apiKey,
      api: (first.api ?? "openai-completions") as Api,
      models: models.map((m: CloudModel) => ({
        id: m.upstreamModelId,
        name: m.label,
        reasoning: m.capabilities ? (m.capabilities.reasoning ?? false) : false,
        input:
          m.capabilities && m.capabilities.vision
            ? (["text", "image"] as const)
            : (["text"] as const),
        contextWindow: m.contextWindow ?? 128000,
        maxTokens: m.maxOutputTokens ?? 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      })),
    });
  }

  const def = rawModels.find((m) => m.isDefault);
  if (def) {
    defaultModelRef = { providerId: def.providerId, modelId: def.upstreamModelId };
  }
}
