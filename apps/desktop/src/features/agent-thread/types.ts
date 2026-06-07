type PrepareAgentThreadInput = {
  projectId: string;
  sessionId: string;
  threadId: string;
};

type AgentRuntimeConnection = {
  projectId: string;
  sessionId: string;
  baseUrl: string;
  token: string;
};

type AgentThreadPanelParams = {
  projectId: string;
  sessionId: string;
  threadId: string;
};

type GetAgentThreadContextUsageInput = {
  threadId: string;
};

type AgentThreadContextUsage = {
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
  updatedAt: string;
};

type AgentThreadMessageKind = "prompt" | "event" | "result";

type AgentThreadMessageRecord = {
  id: string;
  threadId: string;
  kind: AgentThreadMessageKind;
  requestId: string;
  message: unknown;
  createdAt: string;
};

type ListAgentThreadMessagesInput = {
  threadId: string;
};

type SaveAgentThreadMessageInput = {
  threadId: string;
  kind: AgentThreadMessageKind;
  requestId: string;
  message: unknown;
};

export type {
  AgentRuntimeConnection,
  AgentThreadContextUsage,
  AgentThreadMessageKind,
  AgentThreadMessageRecord,
  AgentThreadPanelParams,
  GetAgentThreadContextUsageInput,
  ListAgentThreadMessagesInput,
  PrepareAgentThreadInput,
  SaveAgentThreadMessageInput,
};
