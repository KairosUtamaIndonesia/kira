import type { Model } from "@earendil-works/pi-ai";

import type { ModelConfig } from "./model-catalog";

type OpenAICompletionsThinkingLevelMap = NonNullable<
  Model<"openai-completions">["thinkingLevelMap"]
>;

/**
 * Build a pi-ai `Model` from a Kira organization catalog entry.
 *
 * Kira's catalog targets an OpenAI-compatible API against a custom provider
 * base URL, so we construct the model directly rather than resolving it from
 * pi's built-in model registry. Costs are zeroed here; spend accounting is
 * derived from provider-reported usage, not local price tables.
 */
export function piModelFromConfig(config: ModelConfig): Model<"openai-completions"> {
  const caps = config.capabilities;
  const reasoning = caps !== undefined ? (caps.reasoning ?? false) : false;

  const supportsVision = caps !== undefined ? caps.vision === true : false;

  return {
    id: config.upstreamModelId,
    name: config.label,
    api: "openai-completions",
    provider: config.providerId,
    baseUrl: config.providerBaseUrl,
    reasoning,
    thinkingLevelMap: openAICompletionsThinkingLevelMap(reasoning),
    input: supportsVision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindow,
    maxTokens: config.maxOutputTokens,
  };
}

function openAICompletionsThinkingLevelMap(reasoning: boolean): OpenAICompletionsThinkingLevelMap {
  // A `null` off value signals pi-ai not to send a provider-specific "none"
  // effort when the Agent Thread has thinking disabled.
  // oxlint-disable-next-line unicorn/no-null -- null is the pi-ai Model contract value
  const off = null;
  if (!reasoning) {
    return { off };
  }

  return {
    off,
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
  };
}
