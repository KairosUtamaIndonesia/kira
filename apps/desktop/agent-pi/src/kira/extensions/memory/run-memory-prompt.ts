/**
 * In-process prompt runner for memory extension operations.
 *
 * Uses the lightweight Agent class for one-shot LLM calls with tools.
 * No subprocess, no session persistence, no harness overhead.
 */

import type { AgentTool, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

import { Agent } from "@earendil-works/pi-agent-core";

import { readAgentProviderApiKey } from "../../env.js";

export interface MemoryPromptOptions {
  /** LLM model to use (always openai-responses for Kira). */
  model: Model<"openai-responses">;
  /** System prompt for the agent. */
  systemPrompt: string | undefined;
  /** Abort signal for cancellation (e.g. AbortSignal.timeout(timeoutMs)). */
  signal: AbortSignal | undefined;
  /** Override thinking level for the model. */
  thinkingLevel: ThinkingLevel | undefined;
  /** Timeout in milliseconds. Creates a combined signal when set alongside signal. */
  timeoutMs: number | undefined;
}

export interface MemoryPromptResult {
  ok: boolean;
  output?: string;
  error?: string;
}

/**
 * Run a prompt through an in-process Agent with the given tools.
 *
 * The agent runs the prompt through the LLM with tool-calling enabled
 * and returns the result. Tools modify their backing stores in-process.
 */
export async function runMemoryPrompt(
  prompt: string,
  tools: AgentTool[],
  options: MemoryPromptOptions,
): Promise<MemoryPromptResult> {
  const apiKey = readAgentProviderApiKey();
  if (apiKey === undefined) {
    return { ok: false, error: "KIRA_AGENT_PROVIDER_API_KEY is not set" };
  }

  // Build combined signal from external signal and/or timeout
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

  // Wire combined signal to agent.abort()
  const handleAbort = () => {
    agent.abort();
  };
  if (signal) {
    signal.addEventListener("abort", handleAbort, { once: true });
  }

  try {
    await agent.prompt(prompt);

    const { messages } = agent.state;
    const last = messages[messages.length - 1];
    if (last === undefined || last.role !== "assistant") {
      return { ok: true };
    }

    const text = last.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return text.length > 0 ? { ok: true, output: text } : { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  } finally {
    if (signal) {
      signal.removeEventListener("abort", handleAbort);
    }
  }
}
