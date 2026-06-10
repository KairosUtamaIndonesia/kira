import {
  calculateContextTokens,
  getLastAssistantUsage,
  type SessionTreeEntry,
} from "@earendil-works/pi-agent-core";

import { getDefaultModel } from "./model-catalog";

/**
 * Context-usage snapshot persisted alongside the session blob. Mirrors the
 * shape the Rust persistence bridge fans into `agent_thread_context_usage`.
 */
export type AgentThreadContextUsage = {
  usedTokens: number;
  contextWindow: number;
  maxOutputTokens: number;
  modelId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
  };
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

/**
 * Derive the bridge context-usage snapshot from pi session entries using the
 * last successful assistant turn's provider-reported usage. Returns `undefined`
 * when no assistant usage exists yet (the bridge field is optional).
 */
export function contextUsageFromEntries(
  entries: SessionTreeEntry[],
): AgentThreadContextUsage | undefined {
  const usage = getLastAssistantUsage(entries);
  if (usage === undefined) {
    return undefined;
  }

  const model = getDefaultModel();
  return {
    usedTokens: calculateContextTokens(usage),
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    modelId: model.upstreamModelId,
    usage: {
      inputTokens: usage.input,
      outputTokens: usage.output,
      reasoningTokens: 0,
      cachedInputTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
    },
    cost: usage.cost,
  };
}
