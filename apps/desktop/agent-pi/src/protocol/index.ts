/**
 * Wire protocol between the desktop frontend and the agent-pi WebSocket transport.
 *
 * Single global WS connection. Commands carry threadId where needed.
 * Thread-specific events are wrapped in { type: "thread_event", threadId, event }.
 */

// ── Commands (client → server) ──────────────────────────────────────

export type ClientCommand =
  // Project registration (sent once per project)
  | {
      type: "register_project";
      projectPath: string;
      projectId: string;
      sessionId: string;
      cloudApiUrl: string;
      cloudApiKey: string;
    }
  // Thread management
  | { type: "register_project"; projectPath: string; projectId: string; sessionId: string; cloudApiUrl: string; cloudApiKey: string }
  | { type: "open_thread"; threadId: string; projectPath: string; sessionId: string }
  | { type: "close_thread"; threadId: string }
  // Thread actions
  | { type: "prompt"; threadId: string; message: string; streamingBehavior?: "steer" | "followUp" }
  | { type: "abort"; threadId: string }
  | { type: "set_thinking_level"; threadId: string; level: ThinkingLevel }
  | { type: "compact"; threadId: string; customInstructions?: string }
  | { type: "get_tree"; threadId: string }
  | { type: "navigate_tree"; threadId: string; entryId: string; summarize?: boolean }
  | { type: "extension_ui_response"; id: string; value?: string; confirmed?: boolean; cancelled?: boolean }
  // Global (no thread context)
  | { type: "refresh_model_catalog" }
  | { type: "generate_title"; requestId: string; prompt: string; assistantText: string }
  | {
      type: "generate_commit_message";
      requestId: string;
      stagedDiff: string;
      recentLog: string;
    };

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

// ── Events (server → client) ────────────────────────────────────────

/** Events that are specific to a thread session. */
export type ThreadServerEvent =
  | { type: "ready" }
  | { type: "error"; message: string }
  // Streaming
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  // Lifecycle
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "turn_start" }
  | { type: "turn_end"; hasToolCalls: boolean }
  // Tool execution
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; partialResult: string }
  | { type: "tool_execution_end"; toolCallId: string; isError: boolean; result?: unknown }
  // Session
  | { type: "state_update"; state: SessionState }
  | { type: "messages"; messages: ClientMessage[] }
  | { type: "compaction_start" }
  | { type: "compaction_end" }
  // Tree
  | { type: "tree_data"; entries: TreeEntry[] }
  | { type: "tree_navigated"; cancelled: boolean }
  // Extension UI — extension/tool needs user input
  | {
      type: "extension_ui_request";
      id: string;
      method: "select";
      title: string;
      options: string[];
      timeout?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "confirm";
      title: string;
      message: string;
      timeout?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "input";
      title: string;
      placeholder?: string;
      timeout?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "notify";
      message: string;
      notifyType?: "info" | "warning" | "error";
    }

/** Top-level event — wraps thread events with their threadId. */
export type ServerEvent =
  | { type: "thread_event"; threadId: string; event: ThreadServerEvent }
  // Global events (no thread context)
  | { type: "error"; message: string }
  | { type: "model_catalog_refreshed"; success: true }
  | { type: "model_catalog_refreshed"; success: false; error: string }
  | { type: "title_generated"; requestId: string; title: string }
  | { type: "title_generation_failed"; requestId: string; error: string }
  | { type: "commit_message_generated"; requestId: string; commitMessage: string }
  | { type: "commit_message_generation_failed"; requestId: string; error: string };

// ── Shared types ────────────────────────────────────────────────────

/** A single content block inside an SDK message — same shape as the Pi SDK uses. */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

export interface ClientMessage {
  id: string;
  role: "user" | "assistant" | "toolResult";
  text: string;
  toolName?: string;
  isError?: boolean;
  /** Links a toolResult back to the toolCall that produced it. */
  toolCallId?: string;
  /** Raw content blocks from the SDK (assistant messages only). */
  content?: ContentBlock[];
}

export interface SessionState {
  model: string | undefined;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  messageCount: number;
  sessionId: string;
  sessionFile: string | undefined;
}

export interface TreeEntry {
  id: string;
  parentId: string | null;
  type: string;
  depth: number;
  preview: string;
  label?: string;
  isLeaf: boolean;
  isActive: boolean;
  isCurrent: boolean;
  timestamp: string;
}

export type { AgentMessage } from "@earendil-works/pi-agent-core";
