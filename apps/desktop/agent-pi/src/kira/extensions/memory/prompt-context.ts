import type { MemoryStore } from "./store/memory-store.js";
import type { MemoryConfig } from "./types.js";

import { MEMORY_POLICY_PROMPT, MEMORY_POLICY_PROMPT_COMPACT } from "./constants.js";

type MemoryPolicyConfig = Pick<MemoryConfig, "memoryPolicyStyle" | "memoryPolicyCustomText">;

export function resolveMemoryPolicyPrompt(config: MemoryPolicyConfig): string {
  const style = config.memoryPolicyStyle ?? "full";

  switch (style) {
    case "compact":
      return MEMORY_POLICY_PROMPT_COMPACT;
    case "custom":
      return config.memoryPolicyCustomText && config.memoryPolicyCustomText.trim().length > 0
        ? config.memoryPolicyCustomText
        : MEMORY_POLICY_PROMPT_COMPACT;
    case "none":
      return "";
    case "full":
    default:
      return MEMORY_POLICY_PROMPT;
  }
}

export async function buildPromptContext(
  config: Pick<MemoryConfig, "memoryMode" | "memoryPolicyStyle" | "memoryPolicyCustomText">,
  store: MemoryStore,
  projectStore: MemoryStore | undefined,
  projectName: string,
): Promise<string> {
  if (config.memoryMode === "policy-only") {
    return resolveMemoryPolicyPrompt(config);
  }

  const memoryBlock = store.formatForSystemPrompt();
  const projectBlock = projectStore ? projectStore.formatProjectBlock(projectName) : "";

  const parts: string[] = [];
  if (memoryBlock) parts.push(memoryBlock);
  if (projectBlock) parts.push(projectBlock);

  return parts.join("\n\n");
}

/**
 * Build a `<session-context>` block with current memory contents for system prompt
 * pre-injection. This gives the agent a warm start by including user profile, global
 * memories, recent failure lessons, and project context directly in the prompt.
 *
 * Also includes the current projectId so the agent can use it with project= in
 * memory_search to find project-scoped memories.
 *
 * Returns empty string when projectId is absent and all stores are empty.
 */
export async function buildSessionContext(
  store: MemoryStore,
  projectStore: MemoryStore | undefined,
  projectName: string,
  projectId?: string | null,
): Promise<string> {
  const memoryBlock = store.formatForSystemPrompt();
  const projectBlock = projectStore ? store.formatProjectBlock(projectName) : "";

  const parts: string[] = [];
  if (memoryBlock) parts.push(memoryBlock);
  if (projectBlock) parts.push(projectBlock);

  const head: string[] = [
    "<session-context>",
    "The following context was loaded from your persistent memory to give you a running start.",
    "It is reference material, not new user input.",
  ];

  if (projectId) {
    head.push(
      "",
      `Current project ID: ${projectId}`,
      "Use this value with project= in memory_search to find project-scoped memories.",
    );
  }

  if (parts.length === 0 && !projectId) return "";

  return [...head, "", ...parts, "", "═══ END SESSION CONTEXT ═══", "</session-context>"].join(
    "\n",
  );
}
