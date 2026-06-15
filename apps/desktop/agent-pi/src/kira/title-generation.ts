import type { AssistantMessage } from "@earendil-works/pi-ai";

import { Agent } from "@earendil-works/pi-agent-core";

import { readAgentProviderApiKey } from "./env";
import { getDefaultModel } from "./model-catalog";
import { piModelFromConfig } from "./pi-model";

const TITLE_SYSTEM_PROMPT = [
  "You generate concise titles for Kira Agent Threads.",
  "Return only the title text. No quotes, no markdown, no punctuation flourish.",
  "Use 3 to 7 words. Prefer specific nouns and verbs from the user's request.",
].join("\n");

type GenerateAgentThreadTitleInput = {
  projectPath: string;
  prompt: string;
  assistantText: string;
};

type GenerateAgentThreadTitleOutput = {
  title: string;
};

async function generateAgentThreadTitle(
  input: GenerateAgentThreadTitleInput,
): Promise<GenerateAgentThreadTitleOutput> {
  const apiKey = readAgentProviderApiKey();
  if (apiKey === undefined) {
    throw new Error("KIRA_AGENT_PROVIDER_API_KEY must be set to generate Agent Thread titles.");
  }

  const agent = new Agent({
    initialState: {
      systemPrompt: TITLE_SYSTEM_PROMPT,
      model: piModelFromConfig(getDefaultModel()),
    },
    getApiKey: () => apiKey,
  });

  await agent.prompt(titlePrompt(input));
  const { messages } = agent.state;
  const response = messages[messages.length - 1];
  if (response === undefined || response.role !== "assistant") {
    throw new Error("The title generator returned no assistant message.");
  }
  const title = normalizeTitle(assistantText(response));
  if (title.length === 0) {
    throw new Error("The title generator returned an empty title.");
  }
  return { title };
}

function titlePrompt(input: GenerateAgentThreadTitleInput) {
  return [
    "Create a short title for this Agent Thread.",
    "",
    "User prompt:",
    input.prompt,
    "",
    "Assistant response:",
    input.assistantText,
  ].join("\n");
}

function assistantText(message: AssistantMessage) {
  const parts: string[] = [];
  for (const content of message.content) {
    if (content.type === "text") {
      parts.push(content.text);
    }
  }
  return parts.join("");
}

function normalizeTitle(value: string) {
  return value
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
}

export { generateAgentThreadTitle };
export type { GenerateAgentThreadTitleInput, GenerateAgentThreadTitleOutput };
