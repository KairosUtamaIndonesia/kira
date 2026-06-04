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
  AgentThreadMessageKind,
  AgentThreadMessageRecord,
  AgentThreadPanelParams,
  ListAgentThreadMessagesInput,
  PrepareAgentThreadInput,
  SaveAgentThreadMessageInput,
};
