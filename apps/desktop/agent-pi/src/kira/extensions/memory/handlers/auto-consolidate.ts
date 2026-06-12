/**
 * Auto-consolidation — when memory hits capacity, trigger automatic
 * consolidation instead of returning an error.
 *
 * Uses runMemoryPrompt to run consolidation in-process with the memory
 * tools, which modify MemoryStore directly — no disk reload needed.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ConsolidationResult } from "../types.js";
export type KiraModel = Model<"openai-responses">;
import type { AgentTool } from "@earendil-works/pi-agent-core";

import { CONSOLIDATION_PROMPT, ENTRY_DELIMITER } from "../constants.js";
import { runMemoryPrompt } from "../run-memory-prompt.js";
import { MemoryStore } from "../store/memory-store.js";

type MemoryTarget = "memory" | "user" | "failure";
type ToolMemoryTarget = MemoryTarget | "project";

function entriesForTarget(store: MemoryStore, target: MemoryTarget): string[] {
  return target === "user" ? store.getUserEntries() : store.getMemoryEntries();
}

function labelForTarget(target: MemoryTarget, toolTarget: ToolMemoryTarget): string {
  if (toolTarget === "project") return "Project Memory";
  if (target === "user") return "User Profile";
  if (target === "failure") return "Failure Memory";
  return "Memory";
}

export async function triggerConsolidation(
  store: MemoryStore,
  target: MemoryTarget,
  model: KiraModel,
  tools: AgentTool[],
  signal?: AbortSignal,
  timeoutMs: number = 60000,
  toolTarget: ToolMemoryTarget = target,
): Promise<ConsolidationResult> {
  const entries = entriesForTarget(store, target);
  const currentContent = entries.join(ENTRY_DELIMITER);

  const systemPrompt =
    CONSOLIDATION_PROMPT + "\n\nUse the memory tool to consolidate. Target: '" + toolTarget + "'";
  const prompt =
    `--- Current ${labelForTarget(target, toolTarget)} Entries ---\n` +
    (currentContent || "(empty)");

  try {
    const result = await runMemoryPrompt(prompt, tools, {
      model,
      signal,
      timeoutMs,
      systemPrompt,
      thinkingLevel: undefined,
    });

    if (result.ok) {
      return { consolidated: true };
    }
    return {
      consolidated: false,
      error: result.error || `Consolidation failed (unknown error)`,
    };
  } catch (err) {
    return {
      consolidated: false,
      error: `Consolidation failed: ${String(err).slice(0, 200)}`,
    };
  }
}

/**
 * Register the /memory-consolidate command for manual consolidation.
 */
export function registerConsolidateCommand(
  pi: ExtensionAPI,
  store: MemoryStore,
  model: KiraModel,
  tools: AgentTool[],
  timeoutMs: number = 60000,
  projectStore: MemoryStore | null = null,
  projectName?: string | null,
): void {
  pi.registerCommand("memory-consolidate", {
    description: "Manually trigger memory consolidation to free up space",
    handler: async (_args, ctx) => {
      const manualTimeoutMs = Math.max(timeoutMs, 180000);
      const results: string[] = [];
      const targets: Array<{
        label: string;
        store: MemoryStore;
        target: MemoryTarget;
        toolTarget: ToolMemoryTarget;
      }> = [
        { label: "memory", store, target: "memory", toolTarget: "memory" },
        { label: "user", store, target: "user", toolTarget: "user" },
      ];

      if (projectStore) {
        targets.push({
          label: projectName ? `project:${projectName}` : "project",
          store: projectStore,
          target: "memory",
          toolTarget: "project",
        });
      }

      try {
        ctx.ui.notify(
          `🔄 Starting memory consolidation for ${targets.length} target${targets.length === 1 ? "" : "s"}...`,
          "info",
        );
      } catch {
        // Best-effort only. If the command context is already stale, continue
        // with the consolidation work rather than failing before it starts.
      }

      for (const item of targets) {
        const entries = entriesForTarget(item.store, item.target);

        if (entries.length === 0) {
          results.push(`${item.label}: (empty, nothing to consolidate)`);
          continue;
        }

        try {
          ctx.ui.notify(`⏳ Consolidating ${item.label}...`, "info");
        } catch {
          // Best-effort progress feedback only.
        }
        const result = await triggerConsolidation(
          item.store,
          item.target,
          model,
          tools,
          ctx.signal,
          manualTimeoutMs,
          item.toolTarget,
        );

        if (result.consolidated) {
          results.push(`${item.label}: ✅ consolidated`);
        } else {
          results.push(`${item.label}: ❌ ${result.error}`);
        }
      }

      const summary = `\n  🔄 Memory Consolidation\n  ${"─".repeat(30)}\n${results.map((r) => `  ${r}`).join("\n")}`;

      try {
        ctx.ui.notify(summary, "info");
      } catch {
        // In-process consolidation can indirectly trigger a runtime reload/session
        // replacement. If that happens, the original command ctx is stale by
        // the time we reach the final summary, so the command should exit
        // quietly instead of surfacing a stale-ctx error.
      }
    },
  });
}
