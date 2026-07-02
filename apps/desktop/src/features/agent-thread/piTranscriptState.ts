/**
 * piTranscriptState — flat message types, nothing else.
 * The actual event handling lives in useAgentThreadConnection.
 */

import type { ContentBlock } from "@kira/agent-pi/protocol";

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "toolResult" | "tool" | "thinking";
  text: string;
  toolName?: string;
  isError?: boolean;
  /** Links a toolResult back to the toolCall that produced it. */
  toolCallId?: string;
  /** Raw content blocks from the SDK (assistant messages only). */
  content?: ContentBlock[];
}

export interface PiTranscriptState {
  messages: TranscriptMessage[];
  isStreaming: boolean;
  model: string | null;
}

export const emptyState: PiTranscriptState = {
  messages: [],
  isStreaming: false,
  model: null,
};
