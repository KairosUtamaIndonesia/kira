/**
 * Shared message serialization — converts Pi SDK messages to the flat protocol format.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";

import type { ContentBlock } from "../protocol";

interface ContentBlockInput {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
}

export interface MessageInput {
  role: string;
  content?: string | ContentBlockInput[];
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
}

/** Matches the protocol's ClientMessage shape. */
export interface FlatMessage {
  id: string;
  role: "user" | "assistant" | "toolResult";
  text: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  /** Raw content blocks from the SDK (assistant messages only). */
  content?: ContentBlock[];
}

export function serializeMessages(session: AgentSession): FlatMessage[] {
  const result: FlatMessage[] = [];

  session.messages.forEach((msg: MessageInput, idx: number) => {
    let role: "user" | "assistant" | "toolResult";
    if (msg.role === "toolResult") {
      role = "toolResult";
    } else if (msg.role === "assistant") {
      role = "assistant";
    } else {
      role = "user";
    }

    if (role === "user") {
      result.push({ id: `msg-${idx}`, role, text: extractText(msg) });
      return;
    }

    if (role === "assistant") {
      const content: ContentBlock[] | undefined = Array.isArray(msg.content)
        ? msg.content.map((b: ContentBlockInput) => flattenBlock(b))
        : undefined;

      let text: string;
      if (content) {
        text = content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
      } else if (typeof msg.content === "string") {
        text = msg.content;
      } else {
        text = "";
      }

      result.push({
        id: `msg-${idx}`,
        role: "assistant",
        text,
        ...(content !== undefined && { content }),
      });
      return;
    }

    if (role === "toolResult") {
      result.push({
        id: `msg-${idx}`,
        role: "toolResult",
        text: extractText(msg),
        ...(msg.toolName !== undefined && { toolName: msg.toolName }),
        ...(msg.toolCallId !== undefined && { toolCallId: msg.toolCallId }),
        isError: msg.isError ?? false,
      });
    }
  });

  return result;
}

function flattenBlock(b: ContentBlockInput): ContentBlock {
  if (b.type === "text") return { type: "text", text: b.text ?? "" };
  if (b.type === "thinking") return { type: "thinking", thinking: b.thinking ?? "" };
  if (b.type === "toolCall") {
    return {
      type: "toolCall",
      id: b.id ?? "",
      name: b.name ?? "",
      arguments: b.arguments ?? b.args ?? {},
    };
  }
  // Unknown block type — treat as text
  return { type: "text", text: JSON.stringify(b) };
}

export function extractText(msg: MessageInput): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((c: ContentBlockInput) => {
        if (c.type === "text") return c.text;
        if (c.type === "toolCall") return `[tool: ${c.name ?? ""}]`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}
