/**
 * session-thread — bridges one AgentSession to the global WebSocket.
 * Events are wrapped with the threadId for frontend routing.
 */

import type { WebSocket } from "ws";

import { type AgentSession, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { ThreadServerEvent } from "../protocol";

import { serializeMessages } from "./serialize";

export function attachSession(ws: WebSocket, session: AgentSession, threadId: string): () => void {
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    const msg = toServerEvent(event, session);
    if (msg) {
      send(ws, { type: "thread_event", threadId, event: msg });
    }
    // After a turn completes, push the canonical message snapshot so the
    // frontend replaces in-flight streaming state with merged tool results.
    if (event.type === "agent_end") {
      send(ws, {
        type: "thread_event",
        threadId,
        event: { type: "messages", messages: serializeMessages(session) },
      });
    }
  });

  return () => {
    unsubscribe();
  };
}

// ── Event mapping ───────────────────────────────────────────────────

export function toServerEvent(
  event: AgentSessionEvent,
  session: AgentSession,
): ThreadServerEvent | undefined {
  switch (event.type) {
    case "agent_start":
      return { type: "agent_start" };
    case "agent_end":
      return { type: "agent_end" };
    case "turn_start":
      return { type: "turn_start" };
    case "turn_end":
      return {
        type: "turn_end",
        hasToolCalls: (event.toolResults ? event.toolResults.length : 0) > 0,
      };
    case "compaction_start":
      return { type: "compaction_start" };
    case "compaction_end":
      return { type: "compaction_end" };

    case "message_update": {
      const e = event.assistantMessageEvent;
      if (e.type === "text_delta") return { type: "text_delta", delta: e.delta };
      if (e.type === "thinking_delta") return { type: "thinking_delta", delta: e.delta };
      return undefined;
    }

    case "tool_execution_start":
      return {
        type: "tool_execution_start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      };

    case "tool_execution_update":
      return {
        type: "tool_execution_update",
        toolCallId: event.toolCallId,
        partialResult: getPartialResultText(event.partialResult),
      };

    case "tool_execution_end":
      return {
        type: "tool_execution_end",
        toolCallId: event.toolCallId,
        isError: event.isError,
        result: event.result,
      };

    case "queue_update":
      return { type: "state_update", state: sessionState(session) };

    default:
      return undefined;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(msg));
}

function getPartialResultText(partialResult: unknown): string {
  if (!partialResult || typeof partialResult !== "object") return "";
  const content = (partialResult as Record<string, unknown>).content;
  if (!Array.isArray(content) || content.length === 0) return "";
  const first = content[0];
  if (!first || typeof first !== "object") return "";
  const text = (first as Record<string, unknown>).text;
  return typeof text === "string" ? text : "";
}

export function pushState(session: AgentSession, ws: WebSocket, threadId: string) {
  send(ws, {
    type: "thread_event",
    threadId,
    event: { type: "state_update", state: sessionState(session) },
  });
}

export function sessionState(session: AgentSession) {
  return {
    model: session.model ? `${session.model.provider}/${session.model.id}` : undefined,
    thinkingLevel: session.thinkingLevel,
    isStreaming: session.isStreaming,
    messageCount: session.messages.length,
    sessionId: session.sessionId,
    sessionFile: session.sessionFile,
  };
}
