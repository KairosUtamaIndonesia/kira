import type { PromptUsage, SessionData } from "@flue/runtime";

import { KIRA_AGENT_CONTEXT_WINDOW, KIRA_AGENT_MAX_OUTPUT_TOKENS, KIRA_AGENT_MODEL } from "./model";

type SessionEntry = SessionData["entries"][number];
type MessageEntry = Extract<SessionEntry, { type: "message" }>;
type CompactionEntry = Extract<SessionEntry, { type: "compaction" }>;
type BranchSummaryEntry = Extract<SessionEntry, { type: "branch_summary" }>;
type AgentMessage = MessageEntry["message"];
type ObjectRecord = Record<string, unknown>;

const SUPPORTED_FLUE_SESSION_DATA_VERSION = 4;

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

type ContextTokenEstimate = {
  usedTokens: number;
  latestUsage: PromptUsage | undefined;
  trailingTokens: number;
};

function agentThreadContextUsageFromSessionData(sessionData: SessionData): AgentThreadContextUsage {
  const contextMessages = buildContextMessages(sessionData);
  const estimate = estimateContextTokens(contextMessages);
  const latestUsage = estimate.latestUsage;
  const inputTokens =
    latestUsage === undefined ? estimate.usedTokens : latestUsage.input + estimate.trailingTokens;

  return {
    usedTokens: estimate.usedTokens,
    contextWindow: KIRA_AGENT_CONTEXT_WINDOW,
    maxOutputTokens: KIRA_AGENT_MAX_OUTPUT_TOKENS,
    modelId: KIRA_AGENT_MODEL,
    usage: {
      inputTokens,
      outputTokens: latestUsage === undefined ? 0 : latestUsage.output,
      reasoningTokens: 0,
      cachedInputTokens: latestUsage === undefined ? 0 : latestUsage.cacheRead,
      cacheWriteTokens: latestUsage === undefined ? 0 : latestUsage.cacheWrite,
    },
    cost: latestUsage === undefined ? zeroCost() : latestUsage.cost,
  };
}

function buildContextMessages(sessionData: SessionData): AgentMessage[] {
  if (sessionData.version !== SUPPORTED_FLUE_SESSION_DATA_VERSION) {
    throw new Error(
      `Cannot estimate Agent Thread context usage from Flue session data version ${String(sessionData.version)}.`,
    );
  }

  const activePath = activeSessionPath(sessionData);
  const latestCompactionIndex = findLatestCompactionIndex(activePath);
  if (latestCompactionIndex === -1) {
    return entriesToContextMessages(activePath);
  }

  const latestCompaction = activePath[latestCompactionIndex];
  if (latestCompaction === undefined || latestCompaction.type !== "compaction") {
    throw new Error("Latest Flue compaction index did not resolve to a compaction entry.");
  }

  const firstKeptIndex = activePath.findIndex(
    (entry) => entry.id === latestCompaction.firstKeptEntryId,
  );
  const keptStart = firstKeptIndex >= 0 ? firstKeptIndex : latestCompactionIndex + 1;
  return [
    createContextSummaryMessage(latestCompaction),
    ...entriesToContextMessages(activePath.slice(keptStart, latestCompactionIndex)),
    ...entriesToContextMessages(activePath.slice(latestCompactionIndex + 1)),
  ];
}

function activeSessionPath(sessionData: SessionData): SessionEntry[] {
  if (sessionData.leafId === null) {
    return [];
  }

  const entriesById = new Map(sessionData.entries.map((entry) => [entry.id, entry]));
  const path: SessionEntry[] = [];
  let current: SessionEntry | undefined = entriesById.get(sessionData.leafId);
  if (current === undefined) {
    throw new Error(`Flue session leaf entry ${sessionData.leafId} was not found.`);
  }

  while (current !== undefined) {
    path.push(current);
    current = current.parentId === null ? undefined : entriesById.get(current.parentId);
  }

  return path.toReversed();
}

function entriesToContextMessages(entries: SessionEntry[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (const entry of entries) {
    if (entry.type === "message") {
      if (shouldIncludeMessageEntry(entry)) {
        messages.push(entry.message);
      }
      continue;
    }

    if (entry.type === "branch_summary") {
      messages.push(createBranchSummaryMessage(entry));
    }
  }
  return messages;
}

function shouldIncludeMessageEntry(entry: MessageEntry): boolean {
  const message = entry.message;
  if (!isObjectRecord(message) || message.role !== "assistant") {
    return true;
  }

  return message.stopReason !== "error" && message.stopReason !== "aborted";
}

function findLatestCompactionIndex(entries: SessionEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry !== undefined && entry.type === "compaction") {
      return index;
    }
  }
  return -1;
}

function createContextSummaryMessage(entry: CompactionEntry): AgentMessage {
  const text = entry.summary.startsWith("[Context Summary]")
    ? entry.summary
    : `[Context Summary]\n\n${entry.summary}`;
  return createUserContextMessage(text, entry.timestamp);
}

function createBranchSummaryMessage(entry: BranchSummaryEntry): AgentMessage {
  return createUserContextMessage(`[Branch Summary]\n\n${entry.summary}`, entry.timestamp);
}

function createUserContextMessage(text: string, timestamp: string): AgentMessage {
  const timestampMs = Date.parse(timestamp);
  if (Number.isNaN(timestampMs)) {
    throw new Error(`Flue session entry timestamp is invalid: ${timestamp}`);
  }

  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: timestampMs,
  } as AgentMessage;
}

function estimateContextTokens(messages: AgentMessage[]): ContextTokenEstimate {
  const latestUsage = latestAssistantUsage(messages);
  if (latestUsage === undefined) {
    const usedTokens = messages.reduce(
      (totalTokens, message) => totalTokens + estimateMessageTokens(message),
      0,
    );
    return { latestUsage, trailingTokens: usedTokens, usedTokens };
  }

  const trailingTokens = messages
    .slice(latestUsage.index + 1)
    .reduce((totalTokens, message) => totalTokens + estimateMessageTokens(message), 0);
  const usageTokens = calculateContextTokens(latestUsage.usage);
  return {
    latestUsage: latestUsage.usage,
    trailingTokens,
    usedTokens: usageTokens + trailingTokens,
  };
}

function latestAssistantUsage(
  messages: AgentMessage[],
): { usage: PromptUsage; index: number } | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }

    const usage = assistantUsage(message);
    if (usage !== undefined) {
      return { usage, index };
    }
  }
  return undefined;
}

function assistantUsage(message: AgentMessage): PromptUsage | undefined {
  if (!isObjectRecord(message) || message.role !== "assistant") {
    return undefined;
  }

  if (message.stopReason === "error" || message.stopReason === "aborted") {
    return undefined;
  }

  return promptUsageFromUnknown(message.usage);
}

function promptUsageFromUnknown(value: unknown): PromptUsage | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const cost = value.cost;
  if (!isObjectRecord(cost)) {
    return undefined;
  }

  const input = value.input;
  const output = value.output;
  const cacheRead = value.cacheRead;
  const cacheWrite = value.cacheWrite;
  const totalTokens = value.totalTokens;
  const inputCost = cost.input;
  const outputCost = cost.output;
  const cacheReadCost = cost.cacheRead;
  const cacheWriteCost = cost.cacheWrite;
  const totalCost = cost.total;

  if (
    typeof input !== "number" ||
    typeof output !== "number" ||
    typeof cacheRead !== "number" ||
    typeof cacheWrite !== "number" ||
    typeof totalTokens !== "number" ||
    typeof inputCost !== "number" ||
    typeof outputCost !== "number" ||
    typeof cacheReadCost !== "number" ||
    typeof cacheWriteCost !== "number" ||
    typeof totalCost !== "number"
  ) {
    return undefined;
  }

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: {
      input: inputCost,
      output: outputCost,
      cacheRead: cacheReadCost,
      cacheWrite: cacheWriteCost,
      total: totalCost,
    },
  };
}

function calculateContextTokens(usage: PromptUsage): number {
  if (usage.totalTokens > 0) {
    return usage.totalTokens;
  }
  return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function estimateMessageTokens(message: AgentMessage): number {
  if (!isObjectRecord(message)) {
    return 0;
  }

  if (message.role === "user") {
    return estimateTokensFromContent(message.content);
  }

  if (message.role === "assistant") {
    return estimateAssistantTokens(message.content);
  }

  if (message.role === "toolResult") {
    return estimateToolResultTokens(message.content);
  }

  return 0;
}

function estimateTokensFromContent(content: unknown): number {
  if (typeof content === "string") {
    return estimateTokensFromCharacterCount(content.length);
  }

  if (!Array.isArray(content)) {
    return 0;
  }

  let characterCount = 0;
  for (const block of content) {
    if (isObjectRecord(block) && block.type === "text" && typeof block.text === "string") {
      characterCount += block.text.length;
    }
  }
  return estimateTokensFromCharacterCount(characterCount);
}

function estimateAssistantTokens(content: unknown): number {
  if (!Array.isArray(content)) {
    return 0;
  }

  let characterCount = 0;
  for (const block of content) {
    if (!isObjectRecord(block)) {
      continue;
    }

    if (block.type === "text" && typeof block.text === "string") {
      characterCount += block.text.length;
      continue;
    }

    if (block.type === "thinking" && typeof block.thinking === "string") {
      characterCount += block.thinking.length;
      continue;
    }

    if (block.type === "toolCall") {
      characterCount += estimateToolCallCharacters(block);
    }
  }
  return estimateTokensFromCharacterCount(characterCount);
}

function estimateToolCallCharacters(block: ObjectRecord): number {
  const nameCharacters = typeof block.name === "string" ? block.name.length : 0;
  const argumentsText = JSON.stringify(block.arguments);
  if (argumentsText === undefined) {
    return nameCharacters;
  }
  return nameCharacters + argumentsText.length;
}

function estimateToolResultTokens(content: unknown): number {
  if (!Array.isArray(content)) {
    return 0;
  }

  let characterCount = 0;
  for (const block of content) {
    if (!isObjectRecord(block)) {
      continue;
    }

    if (block.type === "text" && typeof block.text === "string") {
      characterCount += block.text.length;
      continue;
    }

    if (block.type === "image") {
      characterCount += 4800;
    }
  }
  return estimateTokensFromCharacterCount(characterCount);
}

function estimateTokensFromCharacterCount(characterCount: number): number {
  return Math.ceil(characterCount / 4);
}

function zeroCost(): PromptUsage["cost"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { agentThreadContextUsageFromSessionData };
