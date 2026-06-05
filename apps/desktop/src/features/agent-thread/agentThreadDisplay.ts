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
      type: "assistant-activity";
      id: string;
      createdAt: string;
      requestId: string;
      markdown: string;
      thinking: string;
      tools: AgentThreadToolCallDisplay[];
      errors: AgentThreadErrorDisplay[];
      isStreaming: boolean;
    };

type AgentThreadToolCallDisplay = {
  id: string;
  title: string;
  status: ToolCallStatus | undefined;
  command: string | undefined;
  cwd: string | undefined;
  exitCode: number | undefined;
  duration: string | undefined;
  changedFiles: string[];
  errorMessage: string | undefined;
  details: unknown;
};

type AgentThreadErrorDisplay = {
  id: string;
  message: string;
  details: unknown;
};

type ToolCallStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

type ObjectRecord = Record<string, unknown>;

type RequestActivity = {
  id: string;
  createdAt: string;
  requestId: string;
  markdownParts: string[];
  thinkingParts: string[];
  tools: Map<string, AgentThreadToolCallDisplay>;
  errors: AgentThreadErrorDisplay[];
  sawResult: boolean;
};

function buildAgentThreadTranscript(
  messages: AgentThreadMessageRecord[],
  runtimeIsSending: boolean,
): AgentThreadTranscriptItem[] {
  const items: Array<AgentThreadTranscriptItem | RequestActivity> = [];
  const activityByRequest = new Map<string, RequestActivity>();
  const lastMessage = messages[messages.length - 1];
  const lastRequestId = lastMessage === undefined ? undefined : lastMessage.requestId;

  for (const message of messages) {
    if (message.kind === "prompt") {
      items.push({
        type: "user-message",
        id: message.id,
        createdAt: message.createdAt,
        requestId: message.requestId,
        text: textFromUnknown(message.message),
      });
      continue;
    }

    const activity = ensureActivity(activityByRequest, items, message);

    if (message.kind === "event") {
      applyEventToActivity(activity, message);
      continue;
    }

    if (message.kind === "result") {
      activity.sawResult = true;
      applyResultToActivity(activity, message);
      continue;
    }

    exhaustiveMessageKind(message.kind);
  }

  return items.map((item) => {
    if ("type" in item) {
      return item;
    }

    const isStreaming = runtimeIsSending && item.requestId === lastRequestId;
    return activityToTranscriptItem(item, isStreaming);
  });
}

function ensureActivity(
  activityByRequest: Map<string, RequestActivity>,
  items: Array<AgentThreadTranscriptItem | RequestActivity>,
  message: AgentThreadMessageRecord,
) {
  const existing = activityByRequest.get(message.requestId);
  if (existing !== undefined) {
    return existing;
  }

  const activity: RequestActivity = {
    id: `${message.requestId}:assistant`,
    createdAt: message.createdAt,
    requestId: message.requestId,
    markdownParts: [],
    thinkingParts: [],
    tools: new Map(),
    errors: [],
    sawResult: false,
  };
  activityByRequest.set(message.requestId, activity);
  items.push(activity);
  return activity;
}

function activityToTranscriptItem(
  activity: RequestActivity,
  isStreaming: boolean,
): AgentThreadTranscriptItem {
  return {
    type: "assistant-activity",
    id: activity.id,
    createdAt: activity.createdAt,
    requestId: activity.requestId,
    markdown: activity.markdownParts.join(""),
    thinking: activity.thinkingParts.join(""),
    tools: [...activity.tools.values()],
    errors: activity.errors,
    isStreaming,
  };
}

function applyEventToActivity(activity: RequestActivity, message: AgentThreadMessageRecord) {
  const value = message.message;
  if (!isObjectRecord(value)) {
    return;
  }

  const type = firstString(value, ["type"]);
  if (type === "text_delta") {
    const text = firstString(value, ["text"]);
    if (text !== undefined) {
      activity.markdownParts.push(text);
    }
    return;
  }

  if (type === "thinking_delta") {
    const text = firstString(value, ["delta"]);
    if (text !== undefined) {
      activity.thinkingParts.push(text);
    }
    return;
  }

  if (type === "thinking_end") {
    const content = firstString(value, ["content"]);
    if (content !== undefined && activity.thinkingParts.join("") !== content) {
      activity.thinkingParts.push(content);
    }
    return;
  }

  if (type === "tool_start" || type === "tool_execution_start") {
    upsertTool(activity, message, value, "running");
    return;
  }

  if (type === "tool_execution_update") {
    upsertTool(activity, message, value, "running");
    return;
  }

  if (type === "tool_call" || type === "tool_execution_end") {
    const isError = value.isError === true;
    upsertTool(activity, message, value, isError ? "failed" : "succeeded");
    return;
  }

  const error = errorFromRecord(message.id, value);
  if (error !== undefined) {
    activity.errors.push(error);
  }
}

function applyResultToActivity(activity: RequestActivity, message: AgentThreadMessageRecord) {
  const value = message.message;
  const error = errorFromUnknown(message.id, value);
  if (error !== undefined) {
    activity.errors.push(error);
    return;
  }

  const markdown = assistantMarkdownFromUnknown(value);
  if (markdown.length > 0 && activity.markdownParts.join("").length === 0) {
    activity.markdownParts.push(markdown);
  }
}

function upsertTool(
  activity: RequestActivity,
  message: AgentThreadMessageRecord,
  value: ObjectRecord,
  status: ToolCallStatus,
) {
  const toolCallId = firstString(value, ["toolCallId", "operationId", "taskId"]) ?? message.id;
  const existing = activity.tools.get(toolCallId);
  const args = firstPresent(value, ["args"]);
  const result = firstPresent(value, ["result", "partialResult"]);
  const details = { event: value, args, result };
  const durationMs = firstNumber(value, ["durationMs"]);

  const existingTitle = existing === undefined ? undefined : existing.title;
  const existingCommand = existing === undefined ? undefined : existing.command;
  const existingCwd = existing === undefined ? undefined : existing.cwd;
  const existingExitCode = existing === undefined ? undefined : existing.exitCode;
  const existingDuration = existing === undefined ? undefined : existing.duration;
  const existingChangedFiles = existing === undefined ? [] : existing.changedFiles;
  const existingErrorMessage = existing === undefined ? undefined : existing.errorMessage;

  activity.tools.set(toolCallId, {
    id: toolCallId,
    title: firstString(value, ["toolName", "tool", "name"]) ?? existingTitle ?? "Tool call",
    status,
    command: commandFromUnknown(args) ?? commandFromUnknown(result) ?? existingCommand,
    cwd: cwdFromUnknown(args) ?? cwdFromUnknown(result) ?? existingCwd,
    exitCode: exitCodeFromUnknown(result) ?? existingExitCode,
    duration: durationMs === undefined ? existingDuration : formatDuration(durationMs),
    changedFiles: changedFilesFromUnknown(result) ?? existingChangedFiles,
    errorMessage: errorMessageFromUnknown(result) ?? firstString(value, ["error"]) ?? existingErrorMessage,
    details,
  });
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

  return "";
}

function errorFromUnknown(id: string, value: unknown) {
  if (!isObjectRecord(value)) {
    return;
  }

  return errorFromRecord(id, value);
}

function errorFromRecord(id: string, value: ObjectRecord): AgentThreadErrorDisplay | undefined {
  const message = firstString(value, ["error", "errorMessage"]);
  if (message === undefined) {
    return undefined;
  }

  return { id, message, details: value };
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

function commandFromUnknown(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (!isObjectRecord(value)) {
    return;
  }

  return firstString(value, ["command", "cmd", "input", "action"]);
}

function cwdFromUnknown(value: unknown) {
  if (!isObjectRecord(value)) {
    return;
  }

  return firstString(value, ["cwd", "workingDirectory", "directory"]);
}

function exitCodeFromUnknown(value: unknown) {
  if (!isObjectRecord(value)) {
    return;
  }

  return firstNumber(value, ["exitCode", "code"]);
}

function errorMessageFromUnknown(value: unknown) {
  if (!isObjectRecord(value)) {
    return;
  }

  return firstString(value, ["error", "errorMessage", "message"]);
}

function changedFilesFromUnknown(value: unknown) {
  if (!isObjectRecord(value)) {
    return;
  }

  return stringArrayFromUnknown(firstPresent(value, ["changedFiles", "files", "modifiedFiles"]));
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

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exhaustiveMessageKind(value: never): never {
  throw new Error(`Unknown Agent Thread message kind: ${value}`);
}

export { buildAgentThreadTranscript, stringifyUnknown };
export type { AgentThreadToolCallDisplay, AgentThreadTranscriptItem, ToolCallStatus };
