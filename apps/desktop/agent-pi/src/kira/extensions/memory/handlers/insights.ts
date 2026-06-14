/**
 * Insights command — /memory-insights shows what's stored in persistent memory.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { MemoryStore } from "../store/memory-store.js";

export function registerInsightsCommand(
  pi: ExtensionAPI,
  store: MemoryStore,
  projectStore: MemoryStore | undefined,
  projectName: string,
): void {
  pi.registerCommand("memory-insights", {
    description: "Show what's stored in persistent memory",
    handler: async (_args, ctx) => {
      const memoryEntries = store.getMemoryEntries();
      const userEntries = store.getUserEntries();
      const projectEntries = projectStore ? projectStore.getMemoryEntries() : undefined;

      const lines: string[] = [];
      lines.push("");
      lines.push("  ╔══════════════════════════════════════════════╗");
      lines.push("  ║            🧠 Memory Insights                ║");
      lines.push("  ╚══════════════════════════════════════════════╝");
      lines.push("");

      // Memory section
      lines.push("  📋 MEMORY (your personal notes)");
      lines.push("  " + "─".repeat(44));
      if (memoryEntries.length === 0) {
        lines.push("  (empty)");
      } else {
        for (let i = 0; i < memoryEntries.length; i++) {
          const entry = memoryEntries[i];
          if (!entry) continue;
          const preview = entry.length > 100 ? entry.slice(0, 100) + "..." : entry;
          lines.push(`  ${i + 1}. ${preview}`);
        }
      }
      lines.push("");

      // User section
      lines.push("  👤 USER PROFILE");
      lines.push("  " + "─".repeat(44));
      if (userEntries.length === 0) {
        lines.push("  (empty)");
      } else {
        for (let i = 0; i < userEntries.length; i++) {
          const entry = userEntries[i];
          if (!entry) continue;
          const preview = entry.length > 100 ? entry.slice(0, 100) + "..." : entry;
          lines.push(`  ${i + 1}. ${preview}`);
        }
      }
      lines.push("");

      // Project section
      if (projectEntries !== undefined) {
        lines.push(`  📁 PROJECT MEMORY: ${projectName}`);
        lines.push("  " + "─".repeat(44));
        if (projectEntries.length === 0) {
          lines.push("  (empty)");
        } else {
          for (let i = 0; i < projectEntries.length; i++) {
            const entry = projectEntries[i];
            if (!entry) continue;
            const preview = entry.length > 100 ? entry.slice(0, 100) + "..." : entry;
            lines.push(`  ${i + 1}. ${preview}`);
          }
        }
        lines.push("");
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
