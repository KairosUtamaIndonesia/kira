/**
 * commit-message-generation — generates commit messages using Pi's Agent.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";

import { Agent } from "@earendil-works/pi-agent-core";

import { authStorage, getDefaultModel, modelRegistry } from "./model-registry";

const SYSTEM_PROMPT = [
  "You generate git commit messages in conventional commits format.",
  "Return ONLY the commit message. No explanations, no fences, no quotes.",
  "Format: type(scope): title",
  "Keep title under 72 chars. Valid types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert",
].join("\n");

type GenerateCommitMessageInput = { stagedDiff: string; recentLog: string };
type GenerateCommitMessageOutput = { commitMessage: string };
type GenerateCommitMessageError = { error: string };
type GenerateCommitMessageResult = GenerateCommitMessageOutput | GenerateCommitMessageError;

async function generateCommitMessage(
  input: GenerateCommitMessageInput,
): Promise<GenerateCommitMessageResult> {
  try {
    const defaultRef = getDefaultModel();
    const resolved =
      defaultRef !== undefined ? modelRegistry.find(defaultRef.provider, defaultRef.id) : undefined;
    const model = resolved !== undefined ? resolved : (await modelRegistry.getAvailable())[0];
    if (!model) return { error: "No models available" };

    const agent = new Agent({
      initialState: { systemPrompt: SYSTEM_PROMPT, model },
      getApiKey: () => authStorage.getApiKey(model.provider) ?? "",
    });

    await agent.prompt(formatPrompt(input));
    const messages = agent.state.messages;
    const response = messages[messages.length - 1];
    if (!response || response.role !== "assistant") {
      return { error: "No assistant response" };
    }

    const commitMessage = extractCommitMessage(response);
    if (!commitMessage) return { error: "Empty commit message" };

    return { commitMessage };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function formatPrompt(input: GenerateCommitMessageInput): string {
  return [
    "Generate a conventional commit message for this staged diff.",
    "Recent commits (style reference):",
    input.recentLog.trim(),
    "",
    "Staged diff:",
    input.stagedDiff.trim(),
    "",
    "Commit message:",
  ].join("\n");
}

function extractCommitMessage(message: AssistantMessage): string {
  return message.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim()
    .replace(/^```[\w]*\n?|```$/g, "")
    .trim();
}

export { generateCommitMessage };
export type { GenerateCommitMessageInput, GenerateCommitMessageOutput };
