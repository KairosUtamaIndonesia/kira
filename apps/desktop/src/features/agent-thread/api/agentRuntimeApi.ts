import { invoke } from "@tauri-apps/api/core";

import type {
  AgentRuntimeConnection,
  AgentThreadContextUsage,
  AgentThreadMessageRecord,
  GetAgentThreadContextUsageInput,
  ListAgentThreadMessagesInput,
  PrepareAgentThreadInput,
  RespondToHumanRequestInput,
  SaveAgentThreadMessageInput,
} from "../types";

function startAgentRuntime() {
  return invoke<void>("start_agent_runtime");
}

function prepareAgentThread(input: PrepareAgentThreadInput) {
  return invoke<AgentRuntimeConnection>("prepare_agent_thread", { input });
}

function listAgentThreadMessages(input: ListAgentThreadMessagesInput) {
  return invoke<AgentThreadMessageRecord[]>("agent_thread_messages_list", { input });
}

function getAgentThreadContextUsage(input: GetAgentThreadContextUsageInput) {
  return invoke<AgentThreadContextUsage | null>("agent_thread_context_usage_get", { input });
}

function saveAgentThreadMessage(input: SaveAgentThreadMessageInput) {
  return invoke<AgentThreadMessageRecord>("agent_thread_message_save", { input });
}

function respondToHumanRequest(input: RespondToHumanRequestInput) {
  return invoke<void>("respond_to_agent_thread_request", { input });
}

export {
  getAgentThreadContextUsage,
  listAgentThreadMessages,
  prepareAgentThread,
  respondToHumanRequest,
  saveAgentThreadMessage,
  startAgentRuntime,
};
