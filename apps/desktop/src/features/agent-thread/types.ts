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
  panelId: string;
  title: string;
};

type GetAgentThreadContextUsageInput = {
  threadId: string;
};

type GenerateAgentThreadTitleInput = {
  projectId: string;
  sessionId: string;
  threadId: string;
  prompt: string;
  assistantText: string;
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

type PiMessage = Record<string, unknown>;
type PiEvent = Record<string, unknown>;

type PiToolExecutionState = {
  toolCallId: string;
  toolName: string | undefined;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  input: unknown;
  output: unknown;
  error: string | undefined;
  durationMs: number | undefined;
  event: PiEvent;
  toolUiRequestId: string | undefined;
};

type PiToolUiRequestState = {
  id: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  event: PiEvent;
};

type PiActiveAssistantTurn = {
  id: string;
  createdAt: string;
  textParts: string[];
  thinkingParts: string[];
};

type PiTranscriptState = {
  persistedMessages: PiMessage[];
  activeAssistantTurn: PiActiveAssistantTurn | undefined;
  activeToolExecutions: Record<string, PiToolExecutionState>;
  activeToolUiRequests: Record<string, PiToolUiRequestState>;
  liveEvents: PiEvent[];
};

type RespondToHumanRequest = (requestId: string, response: unknown) => Promise<boolean>;

export type {
  AgentRuntimeConnection,
  AgentThreadContextUsage,
  AgentThreadPanelParams,
  GenerateAgentThreadTitleInput,
  GetAgentThreadContextUsageInput,
  PiActiveAssistantTurn,
  PiEvent,
  PiMessage,
  PiToolExecutionState,
  PiToolUiRequestState,
  PiTranscriptState,
  PrepareAgentThreadInput,
  RespondToHumanRequest,
};
