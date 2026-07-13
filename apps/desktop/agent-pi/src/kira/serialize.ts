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

  session.messages.forEach((msg, idx) => {
    const m = msg as unknown as Record<string, unknown>;
    let role: "user" | "assistant" | "toolResult";
    if (m.role === "toolResult") {
      role = "toolResult";
    } else if (m.role === "assistant") {
      role = "assistant";
    } else {
      role = "user";
    }
    if (role === "user") {
      result.push({ id: `msg-${idx}`, role, text: extractText(m) });
      return;
    }

    if (role === "assistant") {
      const content: ContentBlock[] | undefined = Array.isArray(m.content)
        ? m.content.map((b: Record<string, unknown>) => flattenBlock(b))
        : undefined;

      let text: string;
      if (content) {
        text = content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
      } else if (typeof m.content === "string") {
        text = m.content;
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
        text: extractText(m),
        ...(m.toolName !== undefined ? { toolName: m.toolName as string } : {}),
        ...(m.toolCallId !== undefined ? { toolCallId: m.toolCallId as string } : {}),
        ...(m.isError !== undefined ? { isError: m.isError as boolean } : {}),
      });
    }
  });

  return result;
}

function flattenBlock(b: Record<string, unknown>): ContentBlock {
  if (b.type === "text") return { type: "text", text: (b.text as string) ?? "" };
  if (b.type === "thinking") return { type: "thinking", thinking: (b.thinking as string) ?? "" };
  if (b.type === "toolCall") {
    return {
      type: "toolCall",
      id: (b.id as string) ?? "",
      name: (b.name as string) ?? "",
      arguments: (b.arguments ?? b.args ?? {}) as Record<string, unknown>,
    };
  }
  // Unknown block type — treat as text
  return { type: "text", text: JSON.stringify(b) };
}

export function extractText(msg: Record<string, unknown>): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((c: Record<string, unknown>) => {
        if (c.type === "text") return (c.text as string) ?? "";
        if (c.type === "toolCall") return `[tool: ${(c.name as string) ?? ""}]`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}
