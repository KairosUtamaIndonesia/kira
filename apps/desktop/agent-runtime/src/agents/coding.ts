import { createAgent, defineAgentProfile, type AgentWebSocketHandler } from "@flue/runtime";
import { local } from "@flue/runtime/node";

import { KIRA_AGENT_MODEL, readProjectPath } from "../kira/env";

export const websocket: AgentWebSocketHandler = async (_context, next) => next();

const codingAgent = defineAgentProfile({
  instructions: [
    "You are Kira's desktop coding agent.",
    "Work directly in the project workspace provided by Kira.",
    "Prefer explicit, fail-fast changes and explain material risks before destructive actions.",
  ].join("\n"),
});

export default createAgent(() => {
  const projectPath = readProjectPath();

  return {
    profile: codingAgent,
    model: KIRA_AGENT_MODEL,
    cwd: projectPath,
    sandbox: local({ cwd: projectPath }),
  };
});
