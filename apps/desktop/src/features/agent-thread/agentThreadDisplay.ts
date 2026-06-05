import type { AgentThreadMessageRecord } from "./types";

type AgentThreadTranscriptItem =
  | {
      type: "user-message";
      id: string;
      createdAt: string;
      requestId: string;
      text: string;
    }
  | {
      type: "assistant-message";
      id: string;
      createdAt: string;
      requestId: string;
      markdown: string;
      isStreaming: boolean;
      details: unknown;
    }
  | {
      type: "tool-call";
      id: string;
      createdAt: string;
      requestId: string;
      title: string;
      status: ToolCallStatus | undefined;
      command: string | undefined;
      cwd: string | undefined;
      exitCode: number | undefined;
      duration: string | undefined;
      changedFiles: string[];
      errorMessage: string | undefined;
      details: unknown;
    }
  | {
      type: "event";
      id: string;
      createdAt: string;
      requestId: string;
      label: string;
      details: unknown;
    }
  | {
      type: "error";
      id: string;
      createdAt: string;
      requestId: string;
      message: string;
      details: unknown;
    };

type ToolCallStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

type ObjectRecord = Record<string, unknown>;

function buildAgentThreadTranscript(
  messages: AgentThreadMessageRecord[],
  runtimeIsSending: boolean,
): AgentThreadTranscriptItem[] {
  const lastResultIndex = findLastResultIndex(messages);

  return messages.map((message, index) => {
    if (message.kind === "prompt") {
      return {
        type: "user-message",
        id: message.id,
        createdAt: message.createdAt,
        requestId: message.requestId,
        text: textFromUnknown(message.message),
      };
    }

    if (message.kind === "result") {
      const toolCall = toolCallFromMessage(message);
      if (toolCall !== undefined) {
        return toolCall;
      }

      const error = errorFromMessage(message);
      if (error !== undefined) {
        return error;
      }

      return {
        type: "assistant-message",
        id: message.id,
        createdAt: message.createdAt,
        requestId: message.requestId,
        markdown: assistantMarkdownFromUnknown(message.message),
        isStreaming: runtimeIsSending && index === lastResultIndex,
        details: message.message,
      };
    }

    if (message.kind === "event") {
      const toolCall = toolCallFromMessage(message);
      if (toolCall !== undefined) {
        return toolCall;
      }

      const error = errorFromMessage(message);
      if (error !== undefined) {
        return error;
      }

      return {
        type: "event",
        id: message.id,
        createdAt: message.createdAt,
        requestId: message.requestId,
        label: eventLabelFromUnknown(message.message),
        details: message.message,
      };
    }

    return exhaustiveMessageKind(message.kind);
  });
}

function findLastResultIndex(messages: AgentThreadMessageRecord[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.kind === "result") {
      return index;
    }
  }

  return -1;
}

function toolCallFromMessage(
  message: AgentThreadMessageRecord,
): AgentThreadTranscriptItem | undefined {
  const value = message.message;
  if (!isObjectRecord(value) || !isToolLikeRecord(value)) {
    return undefined;
  }

  const status = toolStatusFromUnknown(firstPresent(value, ["status", "state", "phase"]));
  return {
    type: "tool-call",
    id: message.id,
    createdAt: message.createdAt,
    requestId: message.requestId,
    title: firstString(value, ["toolName", "tool", "name", "command", "type"]) ?? "Tool call",
    status,
    command: firstString(value, ["command", "cmd", "input", "action"]),
    cwd: firstString(value, ["cwd", "workingDirectory", "directory"]),
    exitCode: firstNumber(value, ["exitCode", "code"]),
    duration: firstString(value, ["duration", "elapsed", "elapsedTime"]),
    changedFiles: stringArrayFromUnknown(
      firstPresent(value, ["changedFiles", "files", "modifiedFiles"]),
    ),
    errorMessage: firstString(value, ["error", "errorMessage", "message"]),
    details: value,
  };
}

function isToolLikeRecord(value: ObjectRecord) {
  return [
    "toolName",
    "tool",
    "toolCallId",
    "command",
    "cmd",
    "cwd",
    "workingDirectory",
    "exitCode",
    "changedFiles",
  ].some((key) => key in value);
}

function errorFromMessage(
  message: AgentThreadMessageRecord,
): AgentThreadTranscriptItem | undefined {
  const value = message.message;
  if (typeof value === "string") {
    return undefined;
  }

  if (!isObjectRecord(value)) {
    return undefined;
  }

  const messageText = firstString(value, ["error", "errorMessage"]);
  if (messageText === undefined) {
    return undefined;
  }

  return {
    type: "error",
    id: message.id,
    createdAt: message.createdAt,
    requestId: message.requestId,
    message: messageText,
    details: value,
  };
}

function assistantMarkdownFromUnknown(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (isObjectRecord(value)) {
    const text = firstString(value, ["text", "content", "markdown", "message", "result", "output"]);
    if (text !== undefined) {
      return text;
    }
  }

  return stringifyUnknown(value);
}

function eventLabelFromUnknown(value: unknown) {
  if (isObjectRecord(value)) {
    const label = firstString(value, ["label", "message", "type", "event", "name", "status"]);
    if (label !== undefined) {
      return label;
    }
  }

  if (typeof value === "string") {
    return value;
  }

  return "Agent event";
}

function textFromUnknown(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  return stringifyUnknown(value);
}

function stringifyUnknown(value: unknown) {
  try {
    return JSON.stringify(value, undefined, 2);
  } catch {
    return String(value);
  }
}

function firstString(record: ObjectRecord, keys: string[]) {
  const value = firstPresent(record, keys);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function firstNumber(record: ObjectRecord, keys: string[]) {
  const value = firstPresent(record, keys);
  return typeof value === "number" ? value : undefined;
}

function firstPresent(record: ObjectRecord, keys: string[]) {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return void 0;
}

function stringArrayFromUnknown(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function toolStatusFromUnknown(value: unknown): ToolCallStatus | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  if (
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "canceled"
  ) {
    return value;
  }

  if (value === "success" || value === "completed" || value === "complete") {
    return "succeeded";
  }

  if (value === "error") {
    return "failed";
  }

  return undefined;
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exhaustiveMessageKind(value: never): never {
  throw new Error(`Unknown Agent Thread message kind: ${value}`);
}

export { buildAgentThreadTranscript, stringifyUnknown };
export type { AgentThreadTranscriptItem, ToolCallStatus };
