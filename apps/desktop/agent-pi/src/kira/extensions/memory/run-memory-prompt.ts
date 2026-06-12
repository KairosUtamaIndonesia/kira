/**
 * In-process prompt runner for memory extension operations.
 *
 * Replaces the pattern of spawning a child `pi -p` process with an
 * in-process AgentHarness that has the memory tools registered.
 * No subprocess, no pi CLI dependency, no file-reload dance.
 */

import type { AgentTool, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  SessionMetadata,
  SessionStorage,
  SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

import { AgentHarness, Session, SessionError, uuidv7 } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

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
 * Run a prompt through an in-process AgentHarness with the given tools.
 *
 * The harness creates an ephemeral session (no persistence), runs the prompt
 * through the LLM with tool-calling enabled, and returns the result.
 * Tools modify their backing stores in-process — no disk reload needed.
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

  const harness = new (AgentHarness as unknown as new (options: unknown) => AgentHarness)({
    env: new NodeExecutionEnv({ cwd: process.cwd() }),
    session: new Session(new EphemeralSessionStorage(`memory-prompt-${uuidv7()}`)),
    model: options.model,
    tools,
    systemPrompt: options.systemPrompt ?? "",
    getApiKeyAndHeaders: async () => ({ apiKey }),
  });

  // Wire combined signal to harness.abort(), since harness.prompt() does not
  // accept an external AbortSignal directly.
  const handleAbort = () => {
    void harness.abort();
  };
  signal?.addEventListener("abort", handleAbort, { once: true });

  try {
    const response = await harness.prompt(prompt);
    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text.length > 0) {
      return { ok: true, output: text };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  } finally {
    signal?.removeEventListener("abort", handleAbort);
  }
}

/**
 * In-memory-only session storage for one-shot prompt runs.
 *
 * Copied locally from title-generation.ts to avoid a shared dependency.
 */
class EphemeralSessionStorage implements SessionStorage {
  private readonly metadata: SessionMetadata;
  private readonly entries: SessionTreeEntry[] = [];
  private readonly byId = new Map<string, SessionTreeEntry>();
  private leafId: string | null = JSON.parse("null") as null;

  constructor(id: string) {
    this.metadata = { id, createdAt: new Date().toISOString() };
  }

  async getMetadata(): Promise<SessionMetadata> {
    return this.metadata;
  }

  async getLeafId(): Promise<string | null> {
    return this.leafId;
  }

  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !this.byId.has(leafId)) {
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    }
    this.leafId = leafId;
  }

  async createEntryId(): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = uuidv7().slice(0, 8);
      if (!this.byId.has(id)) {
        return id;
      }
    }
    return uuidv7();
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.type === "leaf" ? entry.targetId : entry.id;
  }

  async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    return this.byId.get(id);
  }

  async findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    return this.entries.filter(
      (entry): entry is Extract<SessionTreeEntry, { type: TType }> => entry.type === type,
    );
  }

  async getLabel(_id: string): Promise<string | undefined> {
    return;
  }

  async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
    if (leafId === null) {
      return [];
    }
    const path: SessionTreeEntry[] = [];
    let current = this.byId.get(leafId);
    if (current === undefined) {
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    }
    while (current !== undefined) {
      path.unshift(current);
      if (current.parentId === undefined || current.parentId === null) {
        break;
      }
      const parent = this.byId.get(current.parentId);
      if (parent === undefined) {
        throw new SessionError("invalid_session", `Entry ${current.parentId} not found`);
      }
      current = parent;
    }
    return path;
  }

  async getEntries(): Promise<SessionTreeEntry[]> {
    return [...this.entries];
  }
}
