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
      blocks: AgentThreadActivityBlock[];
      isStreaming: boolean;
    };

type AgentThreadActivityBlock =
  | { type: "thinking"; id: string; thinking: string }
  | { type: "markdown"; id: string; markdown: string }
  | { type: "tool-call"; tool: AgentThreadToolCallDisplay }
  | { type: "error"; error: AgentThreadErrorDisplay };

type AgentThreadToolCallDisplay = {
  id: string;
  toolName: string;
  toolUiRequestId: string | undefined;
  title: string;
  status: ToolCallStatus | undefined;
  command: string | undefined;
  cwd: string | undefined;
  exitCode: number | undefined;
  duration: string | undefined;
  changedFiles: string[];
  errorMessage: string | undefined;
  input: unknown;
  output: unknown;
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
  blocks: MutableActivityBlock[];
  toolBlockIndexes: Map<string, number>;
};

type MutableActivityBlock =
  | { type: "thinking"; id: string; parts: string[] }
  | { type: "markdown"; id: string; parts: string[] }
  | { type: "tool-call"; tool: AgentThreadToolCallDisplay }
  | { type: "error"; error: AgentThreadErrorDisplay };

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
      applyResultToActivity(activity, message);
      continue;
    }

    exhaustiveMessageKind(message.kind);
  }

  return items.flatMap((item) => {
    if ("type" in item) {
      return [item];
    }
    if (item.blocks.length === 0) {
      return [];
    }
    const isStreaming = runtimeIsSending && item.requestId === lastRequestId;
    return [activityToTranscriptItem(item, isStreaming)];
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
    blocks: [],
    toolBlockIndexes: new Map(),
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
    blocks: activity.blocks.map(activityBlockToTranscriptBlock),
    isStreaming,
  };
}

function activityBlockToTranscriptBlock(block: MutableActivityBlock): AgentThreadActivityBlock {
  if (block.type === "thinking") {
    return { type: "thinking", id: block.id, thinking: block.parts.join("") };
  }

  if (block.type === "markdown") {
    return { type: "markdown", id: block.id, markdown: block.parts.join("") };
  }

  return block;
}

function applyEventToActivity(activity: RequestActivity, message: AgentThreadMessageRecord) {
  const value = message.message;
  if (!isObjectRecord(value)) {
    return;
  }

  const type = firstString(value, ["type"]);
  if (type === "message_update") {
    applyPiMessageUpdate(activity, message, value);
    return;
  }

  if (type === "message_end" || type === "turn_end") {
    applyPiMessageSnapshot(activity, message.id, value);
    return;
  }

  if (type === "tool_execution_start") {
    upsertTool(activity, message, value, "running");
    return;
  }

  if (type === "tool_execution_update") {
    upsertTool(activity, message, value, "running");
    return;
  }

  if (type === "tool_execution_end") {
    const isError = value.isError === true;
    upsertTool(activity, message, value, isError ? "failed" : "succeeded");
    return;
  }

  if (type === "tool_ui_request") {
    upsertToolUiRequest(activity, message, value);
    return;
  }

  if (
    type === "agent_end" ||
    type === "settled" ||
    type === "turn_start" ||
    type === "message_start"
  ) {
    return;
  }

  const error = errorFromRecord(message.id, value);
  if (error !== undefined) {
    activity.blocks.push({ type: "error", error });
  }
}

function applyResultToActivity(activity: RequestActivity, message: AgentThreadMessageRecord) {
  const value = message.message;
  const error = errorFromUnknown(message.id, value);
  if (error !== undefined) {
    activity.blocks.push({ type: "error", error });
    return;
  }

  const markdown = assistantMarkdownFromUnknown(value);
  if (markdown.length > 0 && !activityHasMarkdown(activity)) {
    appendMarkdown(activity, message.id, markdown);
  }
}

function appendMarkdown(activity: RequestActivity, id: string, markdown: string) {
  const lastBlock = activity.blocks[activity.blocks.length - 1];
  if (lastBlock !== undefined && lastBlock.type === "markdown") {
    lastBlock.parts.push(markdown);
    return;
  }

  activity.blocks.push({ type: "markdown", id, parts: [markdown] });
}

function applyPiMessageUpdate(
  activity: RequestActivity,
  message: AgentThreadMessageRecord,
  event: ObjectRecord,
) {
  const assistantEvent = objectRecordFromUnknown(event.assistantMessageEvent);
  if (assistantEvent === undefined) {
    return;
  }

  applyAssistantMessageEvent(activity, message, assistantEvent);
}

function applyPiMessageSnapshot(activity: RequestActivity, id: string, event: ObjectRecord) {
  const assistantMessage = objectRecordFromUnknown(event.message);
  if (assistantMessage !== undefined) {
    appendAssistantMessageContent(activity, id, assistantMessage);
  }
}

function applyAssistantMessageEvent(
  activity: RequestActivity,
  message: AgentThreadMessageRecord,
  event: ObjectRecord,
) {
  const type = firstString(event, ["type"]);
  if (type === "text_delta") {
    const text = firstString(event, ["delta"]);
    if (text !== undefined) {
      appendMarkdown(activity, message.id, text);
    }
    return;
  }

  if (type === "thinking_delta") {
    const text = firstString(event, ["delta"]);
    if (text !== undefined) {
      appendThinking(activity, message.id, text);
    }
    return;
  }

  if (
    type === "text_start" ||
    type === "text_end" ||
    type === "thinking_start" ||
    type === "thinking_end"
  ) {
    return;
  }
}

function appendAssistantMessageContent(
  activity: RequestActivity,
  id: string,
  message: ObjectRecord,
) {
  if (message.role !== "assistant" || !Array.isArray(message.content)) {
    return;
  }

  for (const content of message.content) {
    if (!isObjectRecord(content)) {
      continue;
    }
    if (content.type === "text" && typeof content.text === "string") {
      const text = content.text;
      if (text.length > 0 && !activityHasMarkdown(activity)) {
        appendMarkdown(activity, id, text);
      }
    }
    if (content.type === "thinking" && typeof content.thinking === "string") {
      const thinking = content.thinking;
      if (thinking.length > 0 && !activityHasThinking(activity, thinking)) {
        appendThinking(activity, id, thinking);
      }
    }
  }
}
function appendThinking(activity: RequestActivity, id: string, thinking: string) {
  const lastBlock = activity.blocks[activity.blocks.length - 1];
  if (lastBlock !== undefined && lastBlock.type === "thinking") {
    lastBlock.parts.push(thinking);
    return;
  }

  activity.blocks.push({ type: "thinking", id, parts: [thinking] });
}

function activityHasMarkdown(activity: RequestActivity) {
  return activity.blocks.some(
    (block) => block.type === "markdown" && block.parts.join("").length > 0,
  );
}

function activityHasThinking(activity: RequestActivity, thinking: string) {
  return activity.blocks.some(
    (block) => block.type === "thinking" && block.parts.join("") === thinking,
  );
}

function upsertToolUiRequest(
  activity: RequestActivity,
  message: AgentThreadMessageRecord,
  value: ObjectRecord,
) {
  const toolCallId = firstString(value, ["toolCallId"]);
  if (toolCallId === undefined) {
    return;
  }
  const input = firstPresent(value, ["input"]);
  const toolName = firstString(value, ["toolName"]) ?? "unknown";
  const requestId = firstString(value, ["id"]);
  const event = { ...value, args: input, toolName };
  upsertTool(activity, message, event, "running", requestId);
}

function upsertTool(
  activity: RequestActivity,
  message: AgentThreadMessageRecord,
  value: ObjectRecord,
  status: ToolCallStatus,
  toolUiRequestId?: string,
) {
  const toolCallId = firstString(value, ["toolCallId", "operationId", "taskId"]) ?? message.id;
  const existingBlockIndex = activity.toolBlockIndexes.get(toolCallId);
  const existing =
    existingBlockIndex === undefined ? undefined : toolAtIndex(activity, existingBlockIndex);
  const args = firstPresent(value, ["args"]);
  const result = firstPresent(value, ["result", "partialResult"]);
  const details = { event: value, args, result };
  const durationMs = firstNumber(value, ["durationMs"]);

  const existingToolName = existing === undefined ? undefined : existing.toolName;
  const existingTitle = existing === undefined ? undefined : existing.title;
  const existingCommand = existing === undefined ? undefined : existing.command;
  const existingCwd = existing === undefined ? undefined : existing.cwd;
  const existingExitCode = existing === undefined ? undefined : existing.exitCode;
  const existingDuration = existing === undefined ? undefined : existing.duration;
  const existingChangedFiles = existing === undefined ? [] : existing.changedFiles;
  const existingErrorMessage = existing === undefined ? undefined : existing.errorMessage;
  const existingInput = existing === undefined ? undefined : existing.input;
  const existingOutput = existing === undefined ? undefined : existing.output;
  const existingToolUiRequestId = existing === undefined ? undefined : existing.toolUiRequestId;
  const effectiveArgs = args === undefined ? existingInput : args;
  const effectiveResult = result === undefined ? existingOutput : result;

  const toolName =
    firstString(value, ["toolName", "tool", "name"]) ?? existingToolName ?? "unknown";

  const tool: AgentThreadToolCallDisplay = {
    id: toolCallId,
    toolUiRequestId: toolUiRequestId ?? existingToolUiRequestId,
    toolName,
    title: humanizeToolName(toolName) ?? existingTitle ?? "Tool call",
    status,
    command:
      commandFromUnknown(effectiveArgs) ?? commandFromUnknown(effectiveResult) ?? existingCommand,
    cwd: cwdFromUnknown(effectiveArgs) ?? cwdFromUnknown(effectiveResult) ?? existingCwd,
    exitCode: exitCodeFromUnknown(effectiveResult) ?? existingExitCode,
    duration: durationMs === undefined ? existingDuration : formatDuration(durationMs),
    changedFiles: changedFilesFromUnknown(effectiveResult) ?? existingChangedFiles,
    errorMessage:
      errorMessageFromUnknown(effectiveResult) ??
      firstString(value, ["error"]) ??
      existingErrorMessage,
    input: effectiveArgs,
    output: effectiveResult,
    details,
  };

  if (existingBlockIndex !== undefined) {
    activity.blocks[existingBlockIndex] = { type: "tool-call", tool };
    return;
  }

  activity.toolBlockIndexes.set(toolCallId, activity.blocks.length);
  activity.blocks.push({ type: "tool-call", tool });
}

function toolAtIndex(activity: RequestActivity, index: number) {
  const block = activity.blocks[index];
  if (block === undefined || block.type !== "tool-call") {
    throw new Error(`Agent Thread tool block index ${index} does not point to a tool call.`);
  }

  return block.tool;
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

function objectRecordFromUnknown(value: unknown): ObjectRecord | undefined {
  return isObjectRecord(value) ? value : undefined;
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

function humanizeToolName(name: string) {
  const labels: Record<string, string> = {
    read: "Read file",
    write: "Write file",
    edit: "Edit file",
    bash: "Run command",
    grep: "Search files",
    glob: "Find files",
    task: "Delegate task",
    activate_skill: "Activate skill",
  };

  return labels[name];
}

function exhaustiveMessageKind(value: never): never {
  throw new Error(`Unknown Agent Thread message kind: ${value}`);
}

export { buildAgentThreadTranscript, stringifyUnknown };
export type {
  AgentThreadActivityBlock,
  AgentThreadToolCallDisplay,
  AgentThreadTranscriptItem,
  ToolCallStatus,
};
