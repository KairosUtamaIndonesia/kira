type AgentThreadContext = {
  projectId: string;
  sessionId: string;
  threadId: string;
  projectPath: string;
};

const agentThreadContexts = new Map<string, AgentThreadContext>();

export function listAgentThreadContexts(): AgentThreadContext[] {
  return Array.from(agentThreadContexts.values());
}

export function registerAgentThreadContext(context: AgentThreadContext): void {
  agentThreadContexts.set(context.threadId, context);
}

export function requireAgentThreadContext(threadId: string): AgentThreadContext {
  const context = agentThreadContexts.get(threadId);
  if (context === undefined) {
    throw new Error(`Agent Thread context was not registered for ${threadId}.`);
  }

  return context;
}

export type { AgentThreadContext };
