import type { PiMessage, PiToolExecutionState, PiTranscriptState } from "./types";

type AgentThreadTranscriptItem =
  | {
      type: "user-message";
      id: string;
      createdAt: string;
      text: string;
    }
  | {
      type: "assistant-activity";
      id: string;
      createdAt: string;
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

type TranscriptBuildContext = {
  toolResultsByCallId: Map<string, PiMessage>;
  activeToolsByCallId: Readonly<Record<string, PiToolExecutionState>>;
  anchoredToolCallIds: Set<string>;
};

function buildAgentThreadTranscript(transcript: PiTranscriptState): AgentThreadTranscriptItem[] {
  const context: TranscriptBuildContext = {
    toolResultsByCallId: toolResultsByCallId(transcript.persistedMessages),
    activeToolsByCallId: transcript.activeToolExecutions,
    anchoredToolCallIds: new Set<string>(),
  };
  let items: AgentThreadTranscriptItem[] = [];

  for (const message of transcript.persistedMessages) {
    const item = transcriptItemFromPiMessage(message, context);
    if (item !== undefined) {
      items = appendTranscriptItem(items, item);
    }
  }

  const liveBlocks = liveActivityBlocks(transcript, context.anchoredToolCallIds);
  if (liveBlocks.length > 0) {
    const activeTurn = transcript.activeAssistantTurn;
    items = appendTranscriptItem(items, {
      type: "assistant-activity",
      id: activeTurn === undefined ? "active-assistant-turn" : activeTurn.id,
      createdAt: activeTurn === undefined ? new Date().toISOString() : activeTurn.createdAt,
      blocks: liveBlocks,
      isStreaming: activeTurn !== undefined,
    });
  }

  return items;
}

function appendTranscriptItem(
  items: AgentThreadTranscriptItem[],
  item: AgentThreadTranscriptItem,
): AgentThreadTranscriptItem[] {
  const previous = items[items.length - 1];
  if (
    previous === undefined ||
    previous.type !== "assistant-activity" ||
    item.type !== "assistant-activity"
  ) {
    return [...items, item];
  }

  return [
    ...items.slice(0, -1),
    {
      ...previous,
      id: `${previous.id}:${item.id}`,
      blocks: [...previous.blocks, ...item.blocks],
      isStreaming: previous.isStreaming || item.isStreaming,
    },
  ];
}

function transcriptItemFromPiMessage(
  message: PiMessage,
  context: TranscriptBuildContext,
): AgentThreadTranscriptItem | undefined {
  const role = firstString(message, ["role"]);
  const id = firstString(message, ["id", "responseId"]) ?? messageIdFromTimestamp(message);
  const createdAt = timestampFromMessage(message);

  if (role === "user") {
    return {
      type: "user-message",
      id,
      createdAt,
      text: textFromPiMessage(message),
    };
  }

  if (role === "assistant") {
    const blocks = assistantBlocksFromPiMessage(id, message, context);
    return blocks.length === 0
      ? undefined
      : {
          type: "assistant-activity",
          id,
          createdAt,
          blocks,
          isStreaming: false,
        };
  }

  return undefined;
}

function liveActivityBlocks(
  transcript: PiTranscriptState,
  anchoredToolCallIds: ReadonlySet<string>,
): AgentThreadActivityBlock[] {
  const blocks: AgentThreadActivityBlock[] = [];
  const activeTurn = transcript.activeAssistantTurn;
  if (activeTurn !== undefined) {
    const thinking = activeTurn.thinkingParts.join("");
    if (thinking.length > 0) {
      blocks.push({ type: "thinking", id: `${activeTurn.id}:thinking`, thinking });
    }
    const markdown = activeTurn.textParts.join("");
    if (markdown.length > 0) {
      blocks.push({ type: "markdown", id: `${activeTurn.id}:markdown`, markdown });
    }
  }

  for (const tool of Object.values(transcript.activeToolExecutions)) {
    if (!anchoredToolCallIds.has(tool.toolCallId)) {
      blocks.push({ type: "tool-call", tool: toolDisplayFromPiTool(tool) });
    }
  }

  for (const event of transcript.liveEvents) {
    const error = errorFromRecord(eventId(event), event);
    if (error !== undefined) {
      blocks.push({ type: "error", error });
    }
  }

  return blocks;
}

function assistantBlocksFromPiMessage(
  id: string,
  message: PiMessage,
  context: TranscriptBuildContext,
): AgentThreadActivityBlock[] {
  const content = message.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const blocks: AgentThreadActivityBlock[] = [];
  for (const part of content) {
    if (!isObjectRecord(part)) {
      continue;
    }
    if (part.type === "thinking" && typeof part.thinking === "string" && part.thinking.length > 0) {
      blocks.push({
        type: "thinking",
        id: `${id}:thinking:${blocks.length}`,
        thinking: part.thinking,
      });
    }
    if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
      blocks.push({ type: "markdown", id: `${id}:text:${blocks.length}`, markdown: part.text });
    }
    if (part.type === "toolCall") {
      const tool = toolDisplayFromToolCall(part, context);
      if (tool !== undefined) {
        context.anchoredToolCallIds.add(tool.id);
        blocks.push({ type: "tool-call", tool });
      }
    }
  }
  return blocks;
}

function toolDisplayFromToolCall(
  part: ObjectRecord,
  context: TranscriptBuildContext,
): AgentThreadToolCallDisplay | undefined {
  const toolCallId = firstString(part, ["id"]);
  const toolName = firstString(part, ["name"]);
  if (toolCallId === undefined || toolName === undefined) {
    return undefined;
  }

  const args = isObjectRecord(part.arguments) ? part.arguments : part.arguments;
  const activeTool = context.activeToolsByCallId[toolCallId];
  if (activeTool !== undefined) {
    return toolDisplayFromPiTool(activeTool, args);
  }

  const resultMessage = context.toolResultsByCallId.get(toolCallId);
  return toolDisplayFromPersistedTool(toolCallId, toolName, args, resultMessage);
}

function toolDisplayFromPersistedTool(
  toolCallId: string,
  toolName: string,
  args: unknown,
  resultMessage: PiMessage | undefined,
): AgentThreadToolCallDisplay {
  const output = resultMessage;
  const status = persistedToolStatus(resultMessage);
  const toolUiRequestId =
    resultMessage === undefined ? undefined : firstString(resultMessage, ["toolUiRequestId"]);
  return {
    id: toolCallId,
    toolUiRequestId,
    toolName,
    title: humanizeToolName(toolName) ?? "Tool call",
    status,
    command: commandFromUnknown(args) ?? commandFromUnknown(output),
    cwd: cwdFromUnknown(args) ?? cwdFromUnknown(output),
    exitCode: exitCodeFromUnknown(output),
    duration: undefined,
    changedFiles: changedFilesFromUnknown(output) ?? [],
    errorMessage: errorMessageFromUnknown(output),
    input: args,
    output,
    details: { args, result: resultMessage },
  };
}

function persistedToolStatus(resultMessage: PiMessage | undefined): ToolCallStatus {
  if (resultMessage === undefined) {
    return "queued";
  }

  return resultMessage.isError === true ? "failed" : "succeeded";
}

function toolDisplayFromPiTool(
  tool: PiToolExecutionState,
  fallbackInput?: unknown,
): AgentThreadToolCallDisplay {
  const toolName = tool.toolName ?? "unknown";
  const result = tool.output;
  const args = tool.input === undefined ? fallbackInput : tool.input;
  return {
    id: tool.toolCallId,
    toolUiRequestId: tool.toolUiRequestId,
    toolName,
    title: humanizeToolName(toolName) ?? "Tool call",
    status: tool.status,
    command: commandFromUnknown(args) ?? commandFromUnknown(result),
    cwd: cwdFromUnknown(args) ?? cwdFromUnknown(result),
    exitCode: exitCodeFromUnknown(result),
    duration: tool.durationMs === undefined ? undefined : formatDuration(tool.durationMs),
    changedFiles: changedFilesFromUnknown(result) ?? [],
    errorMessage: errorMessageFromUnknown(result) ?? tool.error,
    input: args,
    output: result,
    details: { event: tool.event, args, result },
  };
}

function toolResultsByCallId(messages: PiMessage[]) {
  const results = new Map<string, PiMessage>();
  for (const message of messages) {
    if (message.role !== "toolResult") {
      continue;
    }
    const toolCallId = firstString(message, ["toolCallId"]);
    if (toolCallId !== undefined) {
      results.set(toolCallId, message);
    }
  }
  return results;
}

function textFromPiMessage(message: PiMessage) {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) => {
      if (!isObjectRecord(part) || part.type !== "text" || typeof part.text !== "string") {
        return [];
      }
      return [part.text];
    })
    .join("");
}

function timestampFromMessage(message: PiMessage) {
  const timestamp = message.timestamp;
  if (typeof timestamp === "string") {
    return timestamp;
  }
  if (typeof timestamp === "number") {
    return new Date(timestamp).toISOString();
  }
  return new Date().toISOString();
}

function messageIdFromTimestamp(message: PiMessage) {
  const role = firstString(message, ["role"]);
  const timestamp = message.timestamp;
  if (role !== undefined && (typeof timestamp === "string" || typeof timestamp === "number")) {
    return `message:${role}:${String(timestamp)}`;
  }
  return crypto.randomUUID();
}

function eventId(event: ObjectRecord) {
  return firstString(event, ["id", "requestId", "toolCallId"]) ?? crypto.randomUUID();
}

function errorFromRecord(id: string, value: ObjectRecord): AgentThreadErrorDisplay | undefined {
  const message = firstString(value, ["error", "errorMessage"]);
  if (message === undefined) {
    return undefined;
  }

  return { id, message, details: value };
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
    ask_user: "Ask user",
  };

  return labels[name];
}

export { buildAgentThreadTranscript, stringifyUnknown };
export type {
  AgentThreadActivityBlock,
  AgentThreadToolCallDisplay,
  AgentThreadTranscriptItem,
  ToolCallStatus,
};
