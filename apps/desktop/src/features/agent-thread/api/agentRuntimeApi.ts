import { invoke } from "@tauri-apps/api/core";

function startAgentRuntime() {
  return invoke<void>("start_agent_runtime");
}

export { startAgentRuntime };
