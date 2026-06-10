import {
  AuthStorage,
  type AgentSession,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { AgentThreadContext } from "./agent-thread-context";

import { readAgentProviderApiKey, readPiSessionRoot } from "./env";
import { getDefaultModel } from "./model-catalog";
import { piModelFromConfig } from "./pi-model";
import { ToolUiBroker } from "./tool-ui-broker";
import { createAskUserTool } from "./tools/ask-user-tool";

type AgentSessionHost = {
  session: AgentSession;
  toolUiBroker: ToolUiBroker;
};

const sessionsByThread = new Map<string, Promise<AgentSessionHost>>();

/**
 * Returns the Pi AgentSession for one Agent Thread, building it on first use.
 *
 * Each Agent Thread owns one Pi-native JSONL session file under Kira's app data
 * directory. The WebSocket is only a live controller for the persisted Pi
 * session; it is not the transcript owner.
 */
export function getOrCreateAgentSession(context: AgentThreadContext): Promise<AgentSessionHost> {
  const existing = sessionsByThread.get(context.threadId);
  if (existing !== undefined) {
    return existing;
  }
  const created = buildAgentSession(context);
  sessionsByThread.set(context.threadId, created);
  return created;
}

async function buildAgentSession(context: AgentThreadContext): Promise<AgentSessionHost> {
  const apiKey = readAgentProviderApiKey();
  if (apiKey === undefined) {
    throw new Error("KIRA_AGENT_PROVIDER_API_KEY must be set to run the agent.");
  }

  const toolUiBroker = new ToolUiBroker();
  const model = piModelFromConfig(getDefaultModel());
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, apiKey);

  const sessionDir = join(readPiSessionRoot(), context.threadId);
  mkdirSync(sessionDir, { recursive: true });
  const sessionFile = join(sessionDir, "session.jsonl");

  const { session } = await createAgentSession({
    cwd: context.projectPath,
    model,
    authStorage,
    modelRegistry: ModelRegistry.inMemory(authStorage),
    sessionManager: SessionManager.open(sessionFile, sessionDir, context.projectPath),
    customTools: [createAskUserTool(toolUiBroker)],
    agentDir: readPiSessionRoot(),
  });

  return { session, toolUiBroker };
}
