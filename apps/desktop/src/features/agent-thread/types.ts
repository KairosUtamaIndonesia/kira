import type { ClientMessage, ServerEvent, TreeEntry } from "@kira/agent-pi/protocol";

type PrepareAgentThreadInput = {
  projectId: string;
  sessionId: string;
  threadId: string;
};

type AgentThreadPanelParams = {
  projectId: string;
  folderPath: string;
  sessionId: string;
  threadId: string;
  panelId: string;
  title: string;
};

type GenerateAgentThreadTitleInput = {
  projectId: string;
  sessionId: string;
  threadId: string;
  prompt: string;
  assistantText: string;
};

import type { ContentBlock } from "@kira/agent-pi/protocol";

/** One transcript entry. Assistant messages carry raw content blocks (pi TUI style).
 *  During streaming, tool/thinking roles are used for in-flight display;
 *  the final state comes from the `messages` snapshot with content blocks. */
type TranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "toolResult" | "tool" | "thinking";
  text: string;
  toolName?: string;
  isError?: boolean;
  /** Links a toolResult back to the toolCall that produced it. */
  toolCallId?: string;
  /** Raw content blocks from the SDK (assistant messages only). */
  content?: ContentBlock[];
};

type PiTranscriptState = {
  messages: TranscriptMessage[];
  isStreaming: boolean;
  model: string | null;
};

export type {
  AgentThreadPanelParams,
  GenerateAgentThreadTitleInput,
  PiTranscriptState,
  PrepareAgentThreadInput,
  TranscriptMessage,
};

export type { ClientMessage, ServerEvent, TreeEntry } from "@kira/agent-pi/protocol";

type RespondToHumanRequest = (requestId: string, response: unknown) => Promise<boolean>;
export type { RespondToHumanRequest };
