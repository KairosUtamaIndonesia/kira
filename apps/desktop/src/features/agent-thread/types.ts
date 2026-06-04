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

export type { AgentRuntimeConnection, AgentThreadPanelParams, PrepareAgentThreadInput };
