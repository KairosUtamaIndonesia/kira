/**
 * Shared message serialization — converts Pi SDK messages to the flat protocol format.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ContentBlock } from "../protocol";

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

  session.messages.forEach((msg: any, idx: number) => {
    const role =
      msg.role === "toolResult" ? "toolResult" : msg.role === "assistant" ? "assistant" : "user";

    if (role === "user") {
      result.push({ id: `msg-${idx}`, role, text: extractText(msg) });
      return;
    }

    if (role === "assistant") {
      const content: ContentBlock[] | undefined = Array.isArray(msg.content)
        ? msg.content.map((b: any) => flattenBlock(b))
        : undefined;

      const text = content
        ? content.filter((b) => b.type === "text").map((b) => b.text).join("")
        : typeof msg.content === "string"
          ? msg.content
          : "";

      result.push({ id: `msg-${idx}`, role: "assistant", text, ...(content !== undefined && { content }) });
      return;
    }

    if (role === "toolResult") {
      result.push({
        id: `msg-${idx}`,
        role: "toolResult",
        text: extractText(msg),
        toolName: msg.toolName,
        toolCallId: msg.toolCallId,
        isError: msg.isError ?? false,
      });
    }
  });

  return result;
}

function flattenBlock(b: any): ContentBlock {
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

export function extractText(msg: any): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((c: any) => {
        if (c.type === "text") return c.text;
        if (c.type === "toolCall") return `[tool: ${c.name ?? ""}]`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}
