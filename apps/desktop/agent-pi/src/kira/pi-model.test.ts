import { describe, expect, test } from "bun:test";

import type { ModelConfig } from "./model-catalog";

import { piModelFromConfig } from "./pi-model";

const disabledModel = piModelFromConfig({
  label: "Non-reasoning model",
  upstreamModelId: "provider/non-reasoning-model",
  providerId: "openrouter",
  providerBaseUrl: "https://example.test/v1",
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  thinkingLevel: "medium",
  isDefault: true,
});
const disabledThinkingLevelMap = disabledModel.thinkingLevelMap;
if (disabledThinkingLevelMap === undefined) {
  throw new Error("Expected non-reasoning model to define a thinking level map.");
}
const disabledThinkingLevel = disabledThinkingLevelMap.off;
if (disabledThinkingLevel === undefined) {
  throw new Error("Expected non-reasoning model to define a disabled thinking level.");
}

const baseConfig: ModelConfig = {
  label: "Default reasoning model",
  upstreamModelId: "provider/model",
  providerId: "openrouter",
  providerBaseUrl: "https://example.test/v1",
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  thinkingLevel: "medium",
  isDefault: true,
  apiKey: "test-key",
};

describe("piModelFromConfig", () => {
  test("enables OpenAI Completions reasoning from provider capabilities", () => {
    const model = piModelFromConfig({
      ...baseConfig,
      capabilities: {
        reasoning: true,
        thinking: true,
        tool_calling: true,
        vision: true,
      },
    });

    expect(model.api).toBe("openai-completions");
    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(["text", "image"]);
    expect(model.thinkingLevelMap).toEqual({
      off: disabledThinkingLevel,
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
    });
  });

  test("does not send a reasoning-off effort for non-reasoning models", () => {
    const model = piModelFromConfig({
      ...baseConfig,
      capabilities: {
        reasoning: false,
        thinking: false,
        tool_calling: true,
        vision: false,
      },
    });

    expect(model.reasoning).toBe(false);
    expect(model.input).toEqual(["text"]);
    expect(model.thinkingLevelMap).toEqual({ off: disabledThinkingLevel });
  });
});
