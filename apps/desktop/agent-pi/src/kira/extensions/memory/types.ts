/**
 * Shared TypeScript types for the Memory extension.
 */

import type { TextContent } from "@earendil-works/pi-ai";

export type MemoryOverflowStrategy = "auto-consolidate" | "reject" | "fifo-evict";

export type SessionSearchVariant = "legacy" | "anchors";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface SessionSearchConfig {
  /** Session search implementation variant. Default: legacy */
  variant: SessionSearchVariant;
}

export interface MemoryConfig {
  /** Prompt memory mode. Default: policy-only */
  memoryMode: "policy-only" | "legacy-inject";
  /** Policy prompt style used when memoryMode is policy-only. Default: full */
  memoryPolicyStyle?: "full" | "compact" | "custom" | "none" | undefined;
  /** Custom policy prompt text used when memoryPolicyStyle is custom */
  memoryPolicyCustomText?: string | undefined;
  /** Max chars for MEMORY.md (agent notes). Default: 5000 */
  memoryCharLimit: number;
  /** Max chars for USER.md (user profile). Default: 5000 */
  userCharLimit: number;
  /** Max chars for project-level MEMORY.md. Default: 5000 */
  projectCharLimit: number;
  /** Turns between background auto-reviews. Default: 10 */
  nudgeInterval: number;
  /** Recent conversation messages included in background review. 0 = all. Default: 0 */
  reviewRecentMessages?: number | undefined;
  /** Enable background learning loop. Default: true */
  reviewEnabled: boolean;
  /** Flush memories before compaction. Default: true */
  flushOnCompact: boolean;
  /** Flush memories on session shutdown. Default: true */
  flushOnShutdown: boolean;
  /** Minimum user turns before flush triggers. Default: 6 */
  flushMinTurns: number;
  /** Recent conversation messages included in session flush. 0 = all. Default: 0 */
  flushRecentMessages?: number | undefined;
  /** Override extension storage directory. Default: AGENT_ROOT/data */
  memoryDir?: string | undefined;
  /** Directory for project-scoped memory (relative to AGENT_ROOT). Default: "projects" */
  projectsMemoryDir?: string | undefined;
  /** Session search configuration. Default: { variant: "legacy" } */
  sessionSearch?: SessionSearchConfig | undefined;
  /** Override model used for in-process memory LLM calls. Default: unset */
  llmModelOverride?: string | undefined;
  /** Override thinking level used for in-process memory LLM calls. Default: unset */
  llmThinkingOverride?: ThinkingLevel | undefined;
  /** Strategy when memory is full. Default: auto-consolidate */
  memoryOverflowStrategy?: MemoryOverflowStrategy | undefined;
  /** Legacy alias for memoryOverflowStrategy. Default: true */
  autoConsolidate: boolean;
  /** Detect user corrections and trigger immediate memory save. Default: true */
  correctionDetection: boolean;
  /** Override strong correction regex sources. Missing = defaults; [] = none. */
  correctionStrongPatterns?: string[] | undefined;
  /** Override weak correction regex sources. Missing = defaults; [] = none. */
  correctionWeakPatterns?: string[] | undefined;
  /** Override negative correction regex sources. Missing = defaults; [] = none. */
  correctionNegativePatterns?: string[] | undefined;
  /** Override directive words used after weak correction patterns. Missing = defaults; [] = none. */
  correctionDirectiveWords?: string[] | undefined;
  /** Inject recent failure memories into the system prompt. Default: true */
  failureInjectionEnabled: boolean;
  /** Maximum age in days for injected failure memories. Default: 7 */
  failureInjectionMaxAgeDays: number;
  /** Maximum number of failure memories to inject. Default: 5 */
  failureInjectionMaxEntries: number;
  /** Tool calls before triggering background review (in addition to turn count). Default: 15 */
  nudgeToolCalls: number;
  /** Maximum time in milliseconds for auto-consolidation to complete. Default: 60000 */
  consolidationTimeoutMs: number;
}

export type MemoryCategory =
  | "failure"
  | "correction"
  | "insight"
  | "preference"
  | "convention"
  | "tool-quirk";

export interface MemoryResult {
  success: boolean;
  error?: string;
  message?: string;
  warning?: string;
  warnings?: string[];
  target?: "memory" | "user" | "failure" | "project";
  entries?: string[];
  usage?: string;
  entry_count?: number;
  evicted_entries?: string[];
  evicted_count?: number;
  matches?: string[];
}

export interface MemorySnapshot {
  memory: string;
  user: string;
}

export interface ConsolidationResult {
  /** Whether consolidation succeeded */
  consolidated: boolean;
  /** Error message if consolidation failed */
  error?: string;
}

export type SkillScope = "global" | "project";

export interface SkillIndex {
  /** Stable id for read/update/delete operations */
  skillId: string;
  /** Whether the skill is global or project-scoped */
  scope: SkillScope;
  /** File name on disk (usually SKILL.md) */
  fileName: string;
  /** Absolute path to the skill file */
  path: string;
  /** Active project name for project-scoped skills */
  projectName?: string | undefined;
  /** Skill slug stored in frontmatter and folder name */
  name: string;
  /** Optional human-friendly title preserved for UI output */
  displayName?: string | undefined;
  /** Short description shown in skill listings */
  description: string;
  /** ISO date created */
  created: string;
  /** ISO date last updated */
  updated: string;
}

export interface SkillDocument extends SkillIndex {
  /** Full markdown body (after frontmatter) */
  body: string;
  /** Version number */
  version: number;
}

export interface SkillResult {
  success: boolean;
  error?: string;
  message?: string;
  fileName?: string;
  skillId?: string;
  scope?: SkillScope;
  path?: string;
  conflictType?: "duplicate" | "similar" | "name-collision" | "scope-conflict";
  similarSkillIds?: string[];
  suggestedAction?: "patch" | "update" | "rename";
}

/**
 * Extract displayable text from a session entry message.
 *
 * Accepts any value — returns null for non-message entries (BashExecutionMessage,
 * NotificationMessage, etc.) that lack a `content` property.
 *
 * Returns the concatenated text, truncated to `maxLength` chars.
 */
export function getMessageText(msg: unknown, maxLength = 500): string | undefined {
  if (typeof msg !== "object" || !msg) return undefined;
  const { role, content } = msg as Record<string, unknown>;
  if (typeof role !== "string") return undefined;

  if (typeof content === "string") {
    return content.slice(0, maxLength);
  }
  if (Array.isArray(content)) {
    const text = (content as TextContent[])
      .filter(
        (block): block is TextContent => block.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text)
      .join("\n");
    return text.length > 0 ? text.slice(0, maxLength) : undefined;
  }
  return undefined;
}
