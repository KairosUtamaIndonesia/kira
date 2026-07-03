/**
 * title-generation — generates thread titles using Pi's Agent.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";

import { Agent } from "@earendil-works/pi-agent-core";

import { authStorage, getDefaultModel, modelRegistry } from "./model-registry";

const TITLE_SYSTEM_PROMPT = [
  "You generate concise titles for Kira Agent Threads.",
  "Return only the title text. No quotes, no markdown, no punctuation flourish.",
  "Use 3 to 7 words. Prefer specific nouns and verbs from the user's request.",
].join("\n");

type GenerateAgentThreadTitleInput = {
  prompt: string;
  assistantText: string;
};

type GenerateAgentThreadTitleOutput = { title: string };

async function generateAgentThreadTitle(
  input: GenerateAgentThreadTitleInput,
): Promise<GenerateAgentThreadTitleOutput> {
  const defaultRef = getDefaultModel();
  const resolved = defaultRef !== undefined ? modelRegistry.find(defaultRef.provider, defaultRef.id) : undefined;
  const model = resolved !== undefined ? resolved : (await modelRegistry.getAvailable())[0];
  if (!model) throw new Error("No models available for title generation");

  const agent = new Agent({
    initialState: { systemPrompt: TITLE_SYSTEM_PROMPT, model },
    getApiKey: () => authStorage.getApiKey(model.provider) ?? "",
  });

  await agent.prompt(titlePrompt(input));
  const messages = agent.state.messages;
  const response = messages[messages.length - 1];
  if (!response || response.role !== "assistant") {
    throw new Error("Title generator returned no assistant message.");
  }
  const title = normalizeTitle(assistantText(response));
  if (!title) throw new Error("Title generator returned an empty title.");
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

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
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
