import { invoke } from "@tauri-apps/api/core";

function startAgentRuntime() {
  return invoke<void>("start_agent_runtime");
}

type GenerateAgentThreadTitleInput = {
  projectId: string;
  sessionId: string;
  threadId: string;
  prompt: string;
  assistantText: string;
};

async function generateAgentThreadTitle(input: GenerateAgentThreadTitleInput): Promise<string> {
  return invoke<string>("generate_agent_thread_title", { input });
}

export { generateAgentThreadTitle, startAgentRuntime };
