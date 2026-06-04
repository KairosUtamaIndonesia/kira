import { invoke } from "@tauri-apps/api/core";

import type { AgentRuntimeConnection, PrepareAgentThreadInput } from "../types";

function startAgentRuntime() {
  return invoke<void>("start_agent_runtime");
}

function prepareAgentThread(input: PrepareAgentThreadInput) {
  return invoke<AgentRuntimeConnection>("prepare_agent_thread", { input });
}

export { prepareAgentThread, startAgentRuntime };
