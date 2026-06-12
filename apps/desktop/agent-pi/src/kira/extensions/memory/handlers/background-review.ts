/**
 * Background review — learning loop that auto-saves memory every N turns.
 * Ported from hermes-agent/run_agent.py (_spawn_background_review, _memory_nudge_interval).
 * See PLAN.md → "Hermes Source File Reference Map" for source lines.
 *
 * Uses runMemoryPrompt for isolated one-shot review in-process,
 * keeping us within Pi's intended extension API.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { MemoryConfig } from "../types.js";
export type KiraModel = Model<"openai-responses">;
import { COMBINED_REVIEW_PROMPT } from "../constants.js";
import { runMemoryPrompt } from "../run-memory-prompt.js";
import { MemoryStore } from "../store/memory-store.js";
import { applyRecentMessageLimit, collectMessageParts } from "./message-parts.js";

export function setupBackgroundReview(
  pi: ExtensionAPI,
  store: MemoryStore,
  projectStore: MemoryStore | undefined,
  config: MemoryConfig,
  model: KiraModel,
  tools: AgentTool[],
): void {
  let turnsSinceReview = 0;
  let toolCallsSinceReview = 0;
  let userTurnCount = 0;
  let reviewInProgress = false;

  pi.on("message_end", async (event, _ctx) => {
    if (event.message.role === "user") {
      userTurnCount++;
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    turnsSinceReview++;

    if (!config.reviewEnabled) return;
    if (reviewInProgress) return;

    // Count tool calls from this turn's message only (not cumulative branch scan —
    // otherwise the counter resets to 0 at review, then immediately re-counts all
    // historical tool calls and re-triggers on every subsequent turn).
    try {
      const msg = event.message;
      if (msg && msg.role === "assistant") {
        const content = msg && msg.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === "object" && block.type === "toolCall") {
              toolCallsSinceReview++;
            }
          }
        }
      }
    } catch {
      // If we can't count tool calls, fall back to turn-based only
    }

    // Trigger on EITHER turn count OR tool call count
    const turnThresholdMet = turnsSinceReview >= config.nudgeInterval;
    const toolCallThresholdMet = toolCallsSinceReview >= config.nudgeToolCalls;

    if (!turnThresholdMet && !toolCallThresholdMet) return;
    if (userTurnCount < 3) return;

    turnsSinceReview = 0;
    toolCallsSinceReview = 0;
    reviewInProgress = true;

    // Build conversation snapshot from session entries (crash-safe)
    let allParts: string[] = [];
    try {
      const entries = ctx.sessionManager.getBranch();
      allParts = collectMessageParts(entries);
    } catch {
      reviewInProgress = false;
      return; // Session expired or empty — nothing to review
    }
    if (allParts.length < 4) {
      reviewInProgress = false;
      return; // Not enough conversation to review
    }
    const parts = applyRecentMessageLimit(allParts, config.reviewRecentMessages);

    const currentMemory = store.getMemoryEntries().join("\n§\n");
    const currentUser = store.getUserEntries().join("\n§\n");
    const currentProject = projectStore ? projectStore.getMemoryEntries().join("\n§\n") : undefined;

    const userPrompt = [
      "--- Current Memory ---",
      currentMemory || "(empty)",
      "",
      "--- Current User Profile ---",
      currentUser || "(empty)",
    ];

    if (currentProject !== undefined) {
      userPrompt.push("", "--- Current Project Memory ---", currentProject || "(empty)");
    }

    userPrompt.push("", "--- Conversation to Review ---", parts.join("\n\n"));

    // Fire-and-forget: do NOT await. The review runs in-process but is
    // non-blocking; blocking turn_end would freeze the interactive chat.
    void (async () => {
      try {
        const result = await runMemoryPrompt(userPrompt.join("\n"), tools, {
          model,
          signal: undefined,
          systemPrompt: COMBINED_REVIEW_PROMPT,
          thinkingLevel: undefined,
          timeoutMs: 120000,
        });
        reviewInProgress = false;
        if (result.ok && result.output) {
          const output = result.output || "";
          if (output && !output.toLowerCase().includes("nothing to save")) {
            ctx.ui.notify("💾 Memory auto-reviewed and updated", "info");
          }
        }
      } catch {
        // Best-effort: failures (timeout, signal, errors)
        // are silently ignored. The next review cycle will retry.
        reviewInProgress = false;
      }
    })();
  });
}
