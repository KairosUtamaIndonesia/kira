import type {
  PiEvent,
  PiMessage,
  PiToolExecutionState,
  PiTranscriptState,
  SessionTreeNodeJson,
} from "./types";

const emptyPiTranscriptState: PiTranscriptState = {
  persistedMessages: [],
  activeAssistantTurn: undefined,
  activeToolExecutions: {},
  activeToolUiRequests: {},
  liveEvents: [],
  treeNodes: undefined,
  activePath: [],
  activeLeafId: undefined,
  branchParentId: undefined,
};

function hydratePiTranscript(messages: PiMessage[]): PiTranscriptState {
  return { ...emptyPiTranscriptState, persistedMessages: dedupePiMessages(messages) };
}

function appendLocalUserMessage(state: PiTranscriptState, text: string): PiTranscriptState {
  const id = `local:${crypto.randomUUID()}`;
  return {
    ...state,
    persistedMessages: [
      ...state.persistedMessages,
      {
        id,
        role: "user",
        content: [{ type: "text", text }],
        timestamp: new Date().toISOString(),
      },
    ],
    // Include local message in active path so it isn't filtered out.
    activePath: state.activePath.includes(id) ? state.activePath : [...state.activePath, id],
  };
}

function applyPiEvent(state: PiTranscriptState, event: unknown): PiTranscriptState {
  if (!isRecord(event)) {
    return state;
  }

  const typedEvent = event as PiEvent;
  const withEvent = { ...state, liveEvents: [...state.liveEvents, typedEvent] };
  const eventType = stringField(typedEvent, "type");
  switch (eventType) {
    case "message_update":
      return applyMessageUpdate(withEvent, typedEvent);
    case "message_end":
    case "turn_end":
      return applyMessageEnd(withEvent, typedEvent);
    case "tool_execution_start":
      return upsertToolExecution(withEvent, typedEvent, "running");
    case "tool_execution_update":
      return upsertToolExecution(withEvent, typedEvent, "running");
    case "tool_execution_end":
      return upsertToolExecution(
        withEvent,
        typedEvent,
        typedEvent.isError === true ? "failed" : "succeeded",
      );
    case "tool_ui_request":
      return upsertToolUiRequest(withEvent, typedEvent);
    case "tree_updated":
      return applyTreeUpdated(withEvent, typedEvent);
    case "error":
    case "agent_end":
    case "settled":
    case "turn_start":
    case "message_start":
      return withEvent;
    default:
      return withEvent;
  }
}

function applyMessageUpdate(state: PiTranscriptState, event: PiEvent): PiTranscriptState {
  const assistantEvent = recordField(event, "assistantMessageEvent");
  if (assistantEvent === undefined) {
    return state;
  }

  const activeAssistantTurn = state.activeAssistantTurn ?? {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    textParts: [],
    thinkingParts: [],
  };
  const eventType = stringField(assistantEvent, "type");
  if (eventType === "text_delta") {
    const delta = stringField(assistantEvent, "delta") ?? stringField(assistantEvent, "text");
    if (delta === undefined) {
      return { ...state, activeAssistantTurn };
    }
    return {
      ...state,
      activeAssistantTurn: {
        ...activeAssistantTurn,
        textParts: [...activeAssistantTurn.textParts, delta],
      },
    };
  }
  if (eventType === "thinking_delta") {
    const delta = stringField(assistantEvent, "delta") ?? stringField(assistantEvent, "thinking");
    if (delta === undefined) {
      return { ...state, activeAssistantTurn };
    }
    return {
      ...state,
      activeAssistantTurn: {
        ...activeAssistantTurn,
        thinkingParts: [...activeAssistantTurn.thinkingParts, delta],
      },
    };
  }
  return { ...state, activeAssistantTurn };
}

function applyMessageEnd(state: PiTranscriptState, event: PiEvent): PiTranscriptState {
  const message = recordField(event, "message");
  if (message === undefined) {
    return { ...state, activeAssistantTurn: undefined };
  }

  const messageId = stringField(message, "id");
  const parentId = stringField(message, "parentId");
  const activeLeafId = state.activeLeafId;

  // If we know the active path and this message continues it, append.
  let activePath = state.activePath;
  if (messageId !== undefined) {
    if (parentId === activeLeafId || parentId === undefined || activeLeafId === undefined) {
      // Continuing on the same path or we don't have a reference point.
      if (messageId !== undefined && !activePath.includes(messageId)) {
        activePath = [...activePath, messageId];
      }
    } else {
      // Branch detected: the new message's parent differs from the current leaf.
      // Truncate activePath to the branch point and append the new leaf.
      const branchIndex = activePath.indexOf(parentId);
      if (branchIndex >= 0) {
        activePath = [...activePath.slice(0, branchIndex + 1), messageId];
      } else {
        activePath = [messageId];
      }
    }
  }

  return {
    ...state,
    persistedMessages: appendPiMessage(state.persistedMessages, message),
    activeAssistantTurn: undefined,
    activePath,
    activeLeafId: messageId ?? activeLeafId,
  };
}

function applyTreeUpdated(state: PiTranscriptState, event: PiEvent): PiTranscriptState {
  const nodes = event.nodes;
  const currentLeafId = event.currentLeafId;
  if (!Array.isArray(nodes)) {
    return state;
  }
  const treeNodes = nodes as SessionTreeNodeJson[];
  const activeLeafId = typeof currentLeafId === "string" ? currentLeafId : undefined;
  const activePath = activeLeafId === undefined ? [] : computeActivePath(treeNodes, activeLeafId);
  const leafMessageId = activePath.length > 0 ? activePath[activePath.length - 1] : undefined;
  return {
    ...state,
    treeNodes,
    activePath,
    activeLeafId: leafMessageId ?? activeLeafId,
    branchParentId: undefined,
  };
}

function computeActivePath(treeNodes: SessionTreeNodeJson[], leafId: string): string[] {
  const path = buildPath(treeNodes, leafId);
  return path ?? (treeNodes.length > 0 ? [leafId] : []);
}

function buildPath(nodes: SessionTreeNodeJson[], targetId: string): string[] | undefined {
  for (const node of nodes) {
    if (node.id === targetId) {
      return [node.entry.messageId ?? node.id];
    }
    if (node.children.length > 0) {
      const childPath = buildPath(node.children, targetId);
      if (childPath !== undefined) {
        return [node.entry.messageId ?? node.id, ...childPath];
      }
    }
  }
  return undefined;
}

function upsertToolUiRequest(state: PiTranscriptState, event: PiEvent): PiTranscriptState {
  const id = stringField(event, "id");
  const toolCallId = stringField(event, "toolCallId");
  const toolName = stringField(event, "toolName");
  if (id === undefined || toolCallId === undefined || toolName === undefined) {
    return state;
  }

  const existingTool = state.activeToolExecutions[toolCallId];
  return {
    ...state,
    activeToolUiRequests: {
      ...state.activeToolUiRequests,
      [id]: { id, toolCallId, toolName, input: event.input, event },
    },
    activeToolExecutions: {
      ...state.activeToolExecutions,
      [toolCallId]: {
        ...(existingTool ?? toolExecutionFromEvent(event, "running")),
        toolCallId,
        toolName,
        status: "running",
        input: event.input,
        event,
        toolUiRequestId: id,
      },
    },
  };
}

function upsertToolExecution(
  state: PiTranscriptState,
  event: PiEvent,
  status: PiToolExecutionState["status"],
): PiTranscriptState {
  const toolCallId =
    stringField(event, "toolCallId") ??
    stringField(event, "operationId") ??
    stringField(event, "taskId");
  if (toolCallId === undefined) {
    return state;
  }

  const existing = state.activeToolExecutions[toolCallId];
  const next = toolExecutionFromEvent(event, status, existing);
  return {
    ...state,
    activeToolExecutions: { ...state.activeToolExecutions, [toolCallId]: next },
  };
}

function toolExecutionFromEvent(
  event: PiEvent,
  status: PiToolExecutionState["status"],
  existing?: PiToolExecutionState,
): PiToolExecutionState {
  const toolCallId =
    stringField(event, "toolCallId") ??
    stringField(event, "operationId") ??
    stringField(event, "taskId");
  if (toolCallId === undefined) {
    throw new Error("Pi tool execution event is missing toolCallId.");
  }
  const existingToolName = existing === undefined ? undefined : existing.toolName;
  const existingInput = existing === undefined ? undefined : existing.input;
  const existingOutput = existing === undefined ? undefined : existing.output;
  const existingError = existing === undefined ? undefined : existing.error;
  const existingDurationMs = existing === undefined ? undefined : existing.durationMs;
  const existingToolUiRequestId = existing === undefined ? undefined : existing.toolUiRequestId;
  return {
    toolCallId,
    toolName:
      stringField(event, "toolName") ??
      stringField(event, "tool") ??
      stringField(event, "name") ??
      existingToolName,
    status,
    input: valueOrExisting(event.args, existingInput),
    output: valueOrExisting(event.result ?? event.partialResult, existingOutput),
    error: stringField(event, "error") ?? existingError,
    durationMs: numberField(event, "durationMs") ?? existingDurationMs,
    event,
    toolUiRequestId: existingToolUiRequestId,
  };
}
function appendPiMessage(messages: PiMessage[], message: PiMessage): PiMessage[] {
  const nextKey = piMessageKey(message);
  if (nextKey !== undefined && messages.some((existing) => piMessageKey(existing) === nextKey)) {
    return messages;
  }

  const nextRole = stringField(message, "role");
  const nextText = textFromPiMessage(message);
  if (nextRole !== undefined && nextText.length > 0) {
    const withoutMatchingLocal = messages.filter((existing) => {
      const existingId = stringField(existing, "id");
      return !(
        existingId !== undefined &&
        existingId.startsWith("local:") &&
        stringField(existing, "role") === nextRole &&
        textFromPiMessage(existing) === nextText
      );
    });
    return [...withoutMatchingLocal, message];
  }

  return [...messages, message];
}

function dedupePiMessages(messages: PiMessage[]): PiMessage[] {
  const deduped: PiMessage[] = [];
  for (const message of messages) {
    const key = piMessageKey(message);
    if (key !== undefined && deduped.some((existing) => piMessageKey(existing) === key)) {
      continue;
    }
    deduped.push(message);
  }
  return deduped;
}

function piMessageKey(message: PiMessage): string | undefined {
  const id = stringField(message, "id") ?? stringField(message, "responseId");
  if (id !== undefined) {
    return `id:${id}`;
  }

  const role = stringField(message, "role");
  const timestamp = message.timestamp;
  if (role !== undefined && (typeof timestamp === "string" || typeof timestamp === "number")) {
    return `timestamp:${role}:${String(timestamp)}`;
  }

  const text = textFromPiMessage(message);
  return role !== undefined && text.length > 0 ? `content:${role}:${text}` : undefined;
}

function textFromPiMessage(message: PiMessage): string {
  const content = message.content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) => {
      if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") {
        return [];
      }
      return [part.text];
    })
    .join("");
}

function valueOrExisting(value: unknown, existing: unknown) {
  return value === undefined ? existing : value;
}

function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { appendLocalUserMessage, applyPiEvent, emptyPiTranscriptState, hydratePiTranscript };
