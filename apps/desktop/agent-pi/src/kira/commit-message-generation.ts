import type { AssistantMessage } from "@earendil-works/pi-ai";

import { Agent } from "@earendil-works/pi-agent-core";

import { fetchAndCacheCatalog, getDefaultModel, type ModelConfig } from "./model-catalog";
import { piModelFromConfig } from "./pi-model";

const SYSTEM_PROMPT = [
  "You are a helpful assistant that generates git commit messages in the conventional commits format.",
  "",
  "Rules:",
  "1. Always generate a commit message — never refuse or say you cannot.",
  "2. Format: type(scope): title",
  "3. Look at the recent commit log to match the existing style of the project.",
  "4. If the recent commits use a specific style (e.g. lowercase titles, specific scope naming), match that style.",
  "5. Keep the title under 72 characters.",
  "6. Add a body with more details when the changes are non-trivial. Use a blank line between title and body.",
  '7. Mark breaking changes with a "!" before the colon, e.g. "feat(api)!: remove deprecated endpoint".',
  "",
  "Valid types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert",
  "",
  "Return ONLY the commit message. No explanations, no markdown fences, no quotes.",
].join("\n");

type GenerateCommitMessageInput = {
  stagedDiff: string;
  recentLog: string;
};

type GenerateCommitMessageOutput = {
  commitMessage: string;
};

type GenerateCommitMessageError = {
  error: string;
};

type GenerateCommitMessageResult = GenerateCommitMessageOutput | GenerateCommitMessageError;

function preprocessDiff(diff: string): string {
  const lines = diff.split("\n");
  const processed: string[] = [];
  let contextRun = 0;

  for (const line of lines) {
    // Trim trailing whitespace
    const trimmed = line.trimEnd();

    // Count consecutive context lines for collapsing
    if (trimmed.startsWith(" ") || trimmed.length === 0) {
      contextRun++;
      if (contextRun > 10) {
        continue; // skip excess context lines
      }
    } else {
      contextRun = 0;
    }

    processed.push(trimmed);
  }

  let result = processed.join("\n");

  // Truncate per-file diffs that are excessively long
  const maxFileDiffLength = 500;
  const filePattern = /^diff --git a\/.* b\/.*$/gm;
  let match = filePattern.exec(result);
  while (match !== null) {
    const fileStart = match.index;
    filePattern.lastIndex = match.index + 1; // advance past current match
    const nextMatch = filePattern.exec(result);
    const fileEnd = nextMatch !== null && nextMatch !== undefined ? nextMatch.index : result.length;
    const fileLength = fileEnd - fileStart;

    if (fileLength > maxFileDiffLength) {
      const keepEnd = fileStart + maxFileDiffLength;
      result = result.slice(0, keepEnd) + "\n… (diff truncated) …\n" + result.slice(fileEnd);
      // Adjust for the insertion
      filePattern.lastIndex = keepEnd + "\n… (diff truncated) …\n".length;
    } else {
      filePattern.lastIndex = fileEnd;
    }

    match = filePattern.exec(result);
  }

  return result;
}

function formatPrompt(input: GenerateCommitMessageInput): string {
  return [
    "Generate a conventional commit message for this git staged diff.",
    "",
    "Recent commits in this repository (for style reference):",
    input.recentLog.trim(),
    "",
    "Staged diff:",
    input.stagedDiff.trim(),
    "",
    "Commit message:",
  ].join("\n");
}

async function generateCommitMessage(
  input: GenerateCommitMessageInput,
): Promise<GenerateCommitMessageResult> {
  try {
    await fetchAndCacheCatalog();
  } catch (error) {
    return {
      error: `failed to load model catalog: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let modelConfig: ModelConfig;
  try {
    modelConfig = getDefaultModel();
  } catch {
    return { error: "no default model found in the organization catalog" };
  }

  const apiKey = modelConfig.apiKey;
  if (apiKey === undefined) {
    return { error: "no API key configured for the model — add one in the model config" };
  }

  const model = piModelFromConfig(modelConfig);

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
    },
    getApiKey: () => apiKey,
  });

  const processedDiff = preprocessDiff(input.stagedDiff);
  const prompt = formatPrompt({ ...input, stagedDiff: processedDiff });

  try {
    await agent.prompt(prompt);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { error: `commit message generation failed: ${reason}` };
  }

  const { messages } = agent.state;
  const response = messages[messages.length - 1];
  if (response === undefined || response.role !== "assistant") {
    return { error: "commit message generation returned no assistant response" };
  }

  const commitMessage = extractCommitMessage(response);
  if (commitMessage.length === 0) {
    return { error: "commit message generation returned an empty message" };
  }

  return { commitMessage };
}

function extractCommitMessage(message: AssistantMessage): string {
  const parts: string[] = [];
  for (const content of message.content) {
    if (content.type === "text") {
      parts.push(content.text);
    }
  }
  return parts
    .join("")
    .trim()
    .replace(/^```[\w]*\n?|```$/g, "")
    .trim();
}

export { generateCommitMessage };
export type { GenerateCommitMessageInput, GenerateCommitMessageOutput };
