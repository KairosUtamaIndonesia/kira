import { invoke } from "@tauri-apps/api/core";

import type {
  AgentRuntimeConnection,
  AgentThreadContextUsage,
  GenerateAgentThreadTitleInput,
  GetAgentThreadContextUsageInput,
  PrepareAgentThreadInput,
} from "../types";

function startAgentRuntime() {
  return invoke<void>("start_agent_runtime");
}

function prepareAgentThread(input: PrepareAgentThreadInput) {
  return invoke<AgentRuntimeConnection>("prepare_agent_thread", { input });
}

function getAgentThreadContextUsage(input: GetAgentThreadContextUsageInput) {
  return invoke<AgentThreadContextUsage | null>("agent_thread_context_usage_get", { input });
}

function generateAgentThreadTitle(input: GenerateAgentThreadTitleInput) {
  return invoke<string>("generate_agent_thread_title", { input });
}

export {
  generateAgentThreadTitle,
  getAgentThreadContextUsage,
  prepareAgentThread,
  startAgentRuntime,
};
