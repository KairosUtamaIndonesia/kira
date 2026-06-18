import type { AgentTool, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

import { Agent } from "@earendil-works/pi-agent-core";

/** One-shot in-process LLM call with tools. No subprocess, no session persistence. */
export async function runMemoryPrompt(
  prompt: string,
  tools: AgentTool[],
  options: {
    model: Model<"openai-responses">;
    apiKey: string;
    systemPrompt?: string;
    thinkingLevel?: ThinkingLevel;
    timeoutMs?: number;
  },
): Promise<string | undefined> {
  const agent = new Agent({
    initialState: {
      systemPrompt: options.systemPrompt ?? "",
      model: options.model,
      tools,
      thinkingLevel: options.thinkingLevel ?? "off",
    },
    getApiKey: () => options.apiKey,
  });

  if (options.timeoutMs !== undefined) {
    const signal = AbortSignal.timeout(options.timeoutMs);
    signal.addEventListener("abort", () => agent.abort(), { once: true });
  }
  await agent.prompt(prompt);

  const last = agent.state.messages.at(-1);
  if (!last || last.role !== "assistant") return undefined;

  const text = last.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return text || undefined;
}
