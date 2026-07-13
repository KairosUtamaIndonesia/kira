/**
 * agentThreadDisplay — simple message → display item transform.
 * Matches toolCalls to toolResults by toolCallId (pi TUI style).
 */

import type { ContentBlock, TreeEntry } from "@kira/agent-pi/protocol";

import type { PiTranscriptState, TranscriptMessage } from "./types";

// ── Display items ────────────────────────────────────────────────────

export type AgentThreadTranscriptItem =
  | { type: "user-message"; id: string; text: string; createdAt?: string }
  | {
      type: "assistant-activity";
      id: string;
      blocks: AgentThreadActivityBlock[];
      isStreaming: boolean;
      createdAt?: string;
    }
  | { type: "error"; message: string };

export type AgentThreadActivityBlock =
  | { type: "markdown"; id: string; markdown: string }
  | { type: "thinking"; id: string; thinking: string }
  | { type: "tool-call"; tool: AgentThreadToolCallDisplay };

export type ToolCallStatus = "running" | "succeeded" | "failed";

export interface AgentThreadToolCallDisplay {
  id: string;
  toolName: string;
  status: ToolCallStatus;
  input: string;
  output: string;
  /** Optional rich fields for tool-specific rendering (populated from input/output) */
  title?: string;
  command?: string;
  cwd?: string;
  duration?: number;
  exitCode?: number;
  toolUiRequestId?: string;
  errorMessage?: string;
}

// ── Transform ────────────────────────────────────────────────────────

export function buildAgentThreadTranscript(
  state: PiTranscriptState,
  toolOutputs: Record<string, string> = {},
): AgentThreadTranscriptItem[] {
  const items: AgentThreadTranscriptItem[] = [];
  let blockId = 0;
  const nextId = () => `b${blockId++}`;

  // ── First pass: collect toolResults keyed by toolCallId ──────────
  const resultsByCallId = new Map<string, TranscriptMessage>();
  for (const msg of state.messages) {
    if (msg.role === "toolResult" && msg.toolCallId) {
      resultsByCallId.set(msg.toolCallId, msg);
    }
  }

  // ── Second pass: build display items ─────────────────────────────
  for (let i = 0; i < state.messages.length; i++) {
    const msg = state.messages[i];
    if (!msg) continue;
    const streaming = state.isStreaming && i === state.messages.length - 1;

    if (msg.role === "user") {
      items.push({ type: "user-message", id: msg.id, text: msg.text });
      continue;
    }

    // Skip standalone toolResults — they're merged into their toolCall below
    if (msg.role === "toolResult") continue;

    const blocks: AgentThreadActivityBlock[] = [];

    if (msg.role === "assistant") {
      if (msg.content && msg.content.length > 0) {
        // Native content blocks from the SDK (pi TUI style)
        for (const block of msg.content) {
          if (block.type === "text") {
            if (block.text) blocks.push({ type: "markdown", id: nextId(), markdown: block.text });
          } else if (block.type === "thinking") {
            if (block.thinking)
              blocks.push({ type: "thinking", id: nextId(), thinking: block.thinking });
          } else if (block.type === "toolCall") {
            // Match toolCall to its toolResult by toolCallId (pi TUI style)
            const result = resultsByCallId.get(block.id);
            const output = result ? extractTextFromResult(result) : (toolOutputs[block.id] ?? "");
            let status: ToolCallStatus;
            if (result) {
              status = result.isError ? "failed" : "succeeded";
            } else if (toolOutputs[block.id] !== undefined) {
              status = "running";
            } else {
              status = "succeeded";
            }

            const tool = blockToToolDisplay(block, msg.id, output, status);
            blocks.push({ type: "tool-call", tool });
          }
        }
      } else if (msg.text) {
        // Fallback for in-flight or legacy messages
        blocks.push({ type: "markdown", id: nextId(), markdown: msg.text });
      }
    } else if (msg.role === "thinking") {
      // In-flight thinking (before messages snapshot lands)
      if (msg.text) blocks.push({ type: "thinking", id: nextId(), thinking: msg.text });
    } else if (msg.role === "tool") {
      // In-flight tool from tool_execution_start — use toolOutputs for output
      const toolStatus: ToolCallStatus = (() => {
        if (msg.isError) return "failed";
        if (state.isStreaming) return "running";
        return "succeeded";
      })();
      const tool: AgentThreadToolCallDisplay = {
        id: msg.id,
        toolName: msg.toolName ?? "",
        status: toolStatus,
        input: msg.text,
        output: toolOutputs[msg.id] ?? "",
      };
      extractRichFields(tool);
      blocks.push({ type: "tool-call", tool });
    }

    if (blocks.length > 0 || streaming) {
      items.push({ type: "assistant-activity", id: msg.id, blocks, isStreaming: streaming });
    }
  }

  // ── Orphaned toolResults (no matching toolCall in current messages) ──
  for (const msg of state.messages) {
    if (msg.role !== "toolResult" || !msg.toolCallId) continue;
    // Already merged into a toolCall block above? Check if any item references this toolCallId
    const alreadyMerged = items.some(
      (it) =>
        it.type === "assistant-activity" &&
        it.blocks.some((b) => b.type === "tool-call" && b.tool.id === msg.toolCallId),
    );
    if (!alreadyMerged) {
      const tool: AgentThreadToolCallDisplay = {
        id: msg.id,
        toolName: msg.toolName ?? "",
        status: msg.isError ? "failed" : "succeeded",
        input: "",
        output: extractTextFromResult(msg),
      };
      extractRichFields(tool);
      items.push({
        type: "assistant-activity",
        id: msg.id,
        blocks: [{ type: "tool-call", tool }],
        isStreaming: false,
      });
    }
  }

  return items;
}

// ── Helpers ──────────────────────────────────────────────────────────

function blockToToolDisplay(
  block: ContentBlock & { type: "toolCall" },
  msgId: string,
  output: string,
  status: ToolCallStatus,
): AgentThreadToolCallDisplay {
  const args = block.arguments ?? {};
  const tool: AgentThreadToolCallDisplay = {
    id: block.id || msgId,
    toolName: block.name,
    status,
    input: JSON.stringify(args, undefined, 2),
    output,
  };
  extractRichFields(tool);
  return tool;
}

function extractRichFields(tool: AgentThreadToolCallDisplay): void {
  if (!tool.input) return;
  try {
    const parsed = JSON.parse(tool.input);
    if (typeof parsed.command === "string") tool.command = parsed.command;
    if (typeof parsed.path === "string") tool.title = parsed.path;
    if (typeof parsed.pattern === "string") tool.title = parsed.pattern;
  } catch {
    /* plain text */
  }
}

function extractTextFromResult(msg: TranscriptMessage): string {
  if (msg.content && Array.isArray(msg.content)) {
    return msg.content
      .filter((b): b is ContentBlock & { type: "text" } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return msg.text ?? "";
}

// ── Tree helpers ─────────────────────────────────────────────────────

export function treeEntriesToJson(entries: TreeEntry[]): SessionTreeNodeJson[] {
  const map = new Map<string, SessionTreeNodeJson>();
  for (const e of entries) {
    map.set(e.id, {
      id: e.id,
      parentId: e.parentId,
      entry: {
        type: e.type,
        text: e.preview,
        ...(e.label !== undefined ? { label: e.label } : {}),
        ...(e.timestamp !== undefined ? { timestamp: e.timestamp } : {}),
      },
      children: [],
    });
  }
  const roots: SessionTreeNodeJson[] = [];
  for (const e of entries) {
    const node = map.get(e.id);
    if (!node) continue;

    if (e.parentId) {
      const parentNode = map.get(e.parentId);
      if (parentNode) {
        parentNode.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export interface SessionTreeNodeJson {
  id: string;
  parentId: string | null;
  entry: { type: string; text?: string; label?: string; timestamp?: string; role?: string };
  children: SessionTreeNodeJson[];
}

export function treeStateFrom(entries: TreeEntry[], currentLeafId?: string) {
  const nodes = treeEntriesToJson(entries);
  const activePath = currentLeafId ? computeActivePath(nodes, currentLeafId) : [];
  return { nodes, activePath, activeLeafId: activePath[activePath.length - 1] ?? currentLeafId };
}

function computeActivePath(nodes: SessionTreeNodeJson[], leafId: string): string[] {
  for (const node of nodes) {
    if (node.id === leafId) return [node.id];
    const childPath = computeActivePath(node.children, leafId);
    if (childPath.length > 0) return [node.id, ...childPath];
  }
  return [];
}

export function stringifyUnknown(v: unknown): string {
  try {
    return JSON.stringify(v, undefined, 2);
  } catch {
    return String(v);
  }
}
