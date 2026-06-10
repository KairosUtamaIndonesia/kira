import type { Model } from "@earendil-works/pi-ai";

import type { ModelConfig } from "./model-catalog";

/**
 * Build a pi-ai `Model` from a Kira organization catalog entry.
 *
 * Kira's catalog targets the OpenAI Responses API against a custom provider
 * base URL, so we construct the model directly rather than resolving it from
 * pi's built-in model registry. Costs are zeroed here; spend accounting is
 * derived from provider-reported usage, not local price tables.
 */
export function piModelFromConfig(config: ModelConfig): Model<"openai-responses"> {
  return {
    id: config.upstreamModelId,
    name: config.label,
    api: "openai-responses",
    provider: config.providerId,
    baseUrl: config.providerBaseUrl,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindow,
    maxTokens: config.maxOutputTokens,
  };
}
