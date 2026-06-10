import { AgentHarness, type AgentTool, Session } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createCodingTools } from "@earendil-works/pi-coding-agent";

import type { AgentThreadContext } from "./agent-thread-context";

import {
  readAgentProviderApiKey,
  readPersistenceBridgeToken,
  readPersistenceBridgeUrl,
} from "./env";
import { getDefaultModel } from "./model-catalog";
import { piModelFromConfig } from "./pi-model";
import { BridgeSessionStorage } from "./session-storage";
import { createAskUserTool } from "./tools/ask-user-tool";

const SYSTEM_PROMPT = [
  "You are Kira's desktop coding agent — an expert software engineer working directly in the user's project workspace through the Kira desktop app.",
  "",
  "A human operator is present in Kira. This overrides any headless-mode assumption: when you are genuinely blocked on a decision only the user can make — a material ambiguity, a missing requirement, or a risky or destructive choice — use the `ask_user` tool. Resolve everything else yourself from the workspace, files, and project conventions first.",
  "",
  "Working method:",
  "- Explore before editing: locate code with grep/find and read the surrounding context with read. Never guess at APIs, signatures, or file contents.",
  "- Reuse the workspace's existing patterns, naming, and structure instead of introducing parallel conventions.",
  "- Make explicit, fail-fast changes. No silent fallbacks, no catch-and-ignore, no defensive defaulting.",
  "- Fix problems at the source and remove obsolete code rather than layering compatibility shims, unless the user asks for compatibility.",
  "- Use read/edit/write for files, bash for commands, and grep/find/ls to navigate. Edits must match the file exactly as read.",
  "",
  "Before finishing:",
  "- Verify with the strongest relevant check available — build, typecheck, lint, or the specific test covering your change — and report what you ran.",
  "- Explain material risks before destructive or irreversible actions.",
  "",
  "Be concise. Lead with the outcome, cite exact file paths and symbols, and skip ceremony.",
].join("\n");

const harnessesByThread = new Map<string, Promise<AgentHarness>>();

/**
 * Returns the AgentHarness for one Agent Thread, building it on first use.
 *
 * Each thread owns one harness wired to its project cwd, the SQLite-backed
 * session storage, the organization default model, and the coding + ask_user
 * tools. The build is memoized as a promise so concurrent connections to the
 * same thread share a single harness instance.
 */
export function getOrCreateHarness(context: AgentThreadContext): Promise<AgentHarness> {
  const existing = harnessesByThread.get(context.threadId);
  if (existing !== undefined) {
    return existing;
  }
  const created = buildHarness(context);
  harnessesByThread.set(context.threadId, created);
  return created;
}

async function buildHarness(context: AgentThreadContext): Promise<AgentHarness> {
  const apiKey = readAgentProviderApiKey();
  if (apiKey === undefined) {
    throw new Error("KIRA_AGENT_PROVIDER_API_KEY must be set to run the agent.");
  }

  const model = piModelFromConfig(getDefaultModel());
  const storage = await BridgeSessionStorage.open({
    url: readPersistenceBridgeUrl(),
    token: readPersistenceBridgeToken(),
    storageKey: context.threadId,
    agentThreadId: context.threadId,
  });
  const tools: AgentTool[] = [
    ...createCodingTools(context.projectPath),
    createAskUserTool(context.threadId),
  ];

  return new AgentHarness({
    env: new NodeExecutionEnv({ cwd: context.projectPath }),
    session: new Session(storage),
    model,
    tools,
    systemPrompt: SYSTEM_PROMPT,
    getApiKeyAndHeaders: async () => ({ apiKey }),
  });
}
