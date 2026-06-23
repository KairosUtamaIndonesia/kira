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
  const caps = config.capabilities;
  const reasoning = caps !== undefined ? (caps.reasoning ?? false) : false;

  // Build thinkingLevelMap — maps thinking-level labels to API values.
  // A `null` value signals the backend to disable thinking for that level.
  // oxlint-disable-next-line unicorn/no-null — null is the pi-ai Model contract value
  const thinkingLevelMap: Record<string, string | null> = {};
  if (reasoning) {
    // oxlint-disable-next-line unicorn/no-null — contract value for disabled level
    thinkingLevelMap["off"] = null;
    thinkingLevelMap["high"] = "high";
    const hasThinking = caps !== undefined ? caps.thinking === true : false;
    thinkingLevelMap["xhigh"] = hasThinking ? "max" : "high";
  } else {
    // oxlint-disable-next-line unicorn/no-null — contract value for disabled level
    thinkingLevelMap["off"] = null;
  }

  const supportsVision = caps !== undefined ? caps.vision === true : false;

  return {
    id: config.upstreamModelId,
    name: config.label,
    api: "openai-responses",
    provider: config.providerId,
    baseUrl: config.providerBaseUrl,
    reasoning,
    thinkingLevelMap,
    input: supportsVision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindow,
    maxTokens: config.maxOutputTokens,
  };
}
