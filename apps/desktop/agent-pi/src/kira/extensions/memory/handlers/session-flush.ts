/**
 * Session flush — gives the agent one turn to save memories before context is lost.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { MemoryConfig } from "../types.js";

import { FLUSH_PROMPT } from "../constants.js";
import { runMemoryPrompt } from "../run-memory-prompt.js";
import { MemoryStore } from "../store/memory-store.js";
import { collectMessageParts } from "./message-parts.js";
export type KiraModel = Model<"openai-responses">;
import type { AgentTool } from "@earendil-works/pi-agent-core";

export function setupSessionFlush(
  pi: ExtensionAPI,
  _store: MemoryStore,
  _projectStore: MemoryStore | undefined,
  config: MemoryConfig,
  model: KiraModel,
  tools: AgentTool[],
  apiKey: string,
): void {
  let userTurnCount = 0;

  pi.on("message_end", async (event, _ctx) => {
    if (event.message.role === "user") userTurnCount++;
  });

  /** Shared flush logic — builds conversation snapshot and runs in-process */
  async function flush(
    ctx: { sessionManager: { getBranch: () => unknown[] } },
    timeoutMs = 30000,
  ): Promise<void> {
    if (userTurnCount < config.flushMinTurns) return;

    let entries;
    try {
      entries = ctx.sessionManager.getBranch();
    } catch {
      return; // Context already stale
    }

    const parts = collectMessageParts(entries, config.flushRecentMessages);
    const userPrompt = "--- Conversation ---\n" + parts.join("\n\n");

    try {
      await runMemoryPrompt(userPrompt, tools, {
        model,
        apiKey,
        systemPrompt: FLUSH_PROMPT,
        timeoutMs,
      });
    } catch {
      // Best-effort flush — never block shutdown
    }
  }

  // Flush before compaction (can afford to wait)
  pi.on("session_before_compact", async (_event, ctx) => {
    if (!config.flushOnCompact) return;
    await flush(ctx, 30000);
  });

  // Flush before session shutdown (must be fast, non-blocking)
  pi.on("session_shutdown", async (_event, ctx) => {
    if (!config.flushOnShutdown) return;
    // Fire-and-forget with a short timeout so we don't block shutdown.
    // We intentionally do NOT await.
    void (async () => {
      try {
        await flush(ctx, 10000);
      } catch {
        /* fire-and-forget */
      }
    })();
  });
}
