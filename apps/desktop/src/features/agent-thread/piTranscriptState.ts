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
  model: string | undefined;
}

export const emptyState: PiTranscriptState = {
  messages: [],
  isStreaming: false,
  model: undefined,
};

/** Extract display text from an AgentMessage (from pi-agent-core protocol). */
function textOfMessage(msg: { role: string; content?: unknown; text?: string }): string {
  if (msg.role === "assistant" && Array.isArray(msg.content)) {
    return msg.content
      .filter(
        (c: unknown): c is { type: string; text?: string } =>
          typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text",
      )
      .map((c) => c.text ?? "")
      .join("");
  }
  return msg.text ?? "";
}

export { textOfMessage };
