import type { AgentTool, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

import { Agent } from "@earendil-works/pi-agent-core";

import { readAgentProviderApiKey } from "../../env.js";

export interface MemoryPromptOptions {
  model: Model<"openai-responses">;
  systemPrompt: string | undefined;
  signal: AbortSignal | undefined;
  thinkingLevel: ThinkingLevel | undefined;
  timeoutMs: number | undefined;
}

export interface MemoryPromptResult {
  ok: boolean;
  output?: string;
  error?: string;
}

/** One-shot in-process LLM call with tools. No subprocess, no session persistence. */
export async function runMemoryPrompt(
  prompt: string,
  tools: AgentTool[],
  options: MemoryPromptOptions,
): Promise<MemoryPromptResult> {
  const apiKey = readAgentProviderApiKey();
  if (apiKey === undefined) {
    return { ok: false, error: "KIRA_AGENT_PROVIDER_API_KEY is not set" };
  }

  let signal: AbortSignal | undefined;
  if (options.signal && options.timeoutMs !== undefined) {
    signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
  } else if (options.timeoutMs !== undefined) {
    signal = AbortSignal.timeout(options.timeoutMs);
  } else {
    signal = options.signal;
  }

  const agent = new Agent({
    initialState: {
      systemPrompt: options.systemPrompt ?? "",
      model: options.model,
      tools,
      thinkingLevel: options.thinkingLevel ?? "off",
    },
    getApiKey: () => apiKey,
  });

  if (signal) {
    signal.addEventListener("abort", () => agent.abort(), { once: true });
  }

  try {
    await agent.prompt(prompt);

    const last = agent.state.messages.at(-1);
    if (!last || last.role !== "assistant") {
      return { ok: true };
    }

    const text = last.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return text ? { ok: true, output: text } : { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
