import {
  AuthStorage,
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { AgentThreadContext } from "./agent-thread-context";

import { setCurrentProjectId } from "./agent-thread-context";
import { readOptionalEnv } from "./env";
import guardrailsExtension from "./extensions/guardrails";
import memoryExtension from "./extensions/memory";
import { AGENT_ROOT } from "./extensions/memory/paths.js";
import { fetchAndCacheCatalog, getDefaultModel } from "./model-catalog";
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
  // Fetch the model catalog from the Rust backend before any consumer needs it.
  await fetchAndCacheCatalog();

  const modelConfig = getDefaultModel();
  const model = piModelFromConfig(modelConfig);
  const apiKey = modelConfig.apiKey;
  if (apiKey === undefined) {
    throw new Error("No API key configured for the default model. Add one in the model config.");
  }

  const toolUiBroker = new ToolUiBroker();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(model.provider, apiKey);

  const sessionDir = join(AGENT_ROOT, "sessions", context.threadId);
  mkdirSync(sessionDir, { recursive: true });
  const sessionFile = join(sessionDir, "session.jsonl");

  const shellPath = readOptionalEnv("KIRA_AGENT_SHELL_PATH");
  const settingsManager =
    shellPath !== undefined ? SettingsManager.inMemory({ shellPath }) : undefined;

  const resourceLoader = new DefaultResourceLoader({
    cwd: context.projectPath,
    agentDir: AGENT_ROOT,
    extensionFactories: [memoryExtension, guardrailsExtension],
  });

  // Set the current project id so the memory extension can use the Kira
  // project identity instead of deriving it from the filesystem basename.
  setCurrentProjectId(context.projectId);

  await resourceLoader.reload();
  // Clear the slot immediately after the extension factory runs (it's synchronous
  // during reload) to prevent stale identity leaking into future session builds.
  setCurrentProjectId(undefined);

  const { session } = await createAgentSession({
    cwd: context.projectPath,
    model,
    authStorage,
    modelRegistry: ModelRegistry.inMemory(authStorage),
    sessionManager: SessionManager.open(sessionFile, sessionDir, context.projectPath),
    customTools: [createAskUserTool(toolUiBroker)],
    resourceLoader,
    agentDir: AGENT_ROOT,
    ...(settingsManager !== undefined && { settingsManager }),
  });
  return { session, toolUiBroker };
}
