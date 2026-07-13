/**
 * useAgentThreadConnection — processEvent drives a flat messages array.
 * Uses the global AppSocket connection instead of creating its own WS.
 */

import { type ServerEvent, type ThreadServerEvent, type TreeEntry } from "@kira/agent-pi/protocol";
import { useEffect, useRef, useState, useCallback } from "react";

import type { AgentThreadPanelParams } from "../types";

import { treeStateFrom } from "../agentThreadDisplay";
import { setAgentThreadTitleGenerationState } from "../agentThreadStatusStore";
import { useAppSocket } from "../AppSocketProvider";
import { getCloudConfig } from "../cloudConfig";
import { type TranscriptMessage } from "../piTranscriptState";
import { requestOverSocket } from "../socketRequest";

export type AgentThreadRuntimeState =
  | { status: "starting" }
  | { status: "connecting" }
  | { status: "ready" }
  | { status: "sending" }
  | { status: "error"; message: string }
  | { status: "stopped" };

export type AgentThreadContextUsageState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      usage: {
        usedTokens: number;
        contextWindow: number;
        modelId: string;
        usage?: { total: number };
        cost?: { total: number };
      };
    };

export type ExtensionUiRequest = {
  id: string;
  method: "select" | "confirm" | "input";
  title: string;
  options?: string[];
  message?: string;
  placeholder?: string;
};

export interface UseAgentConnectionResult {
  messages: TranscriptMessage[];
  isStreaming: boolean;
  model: string | undefined;
  runtimeState: AgentThreadRuntimeState;
  treeNodes: ReturnType<typeof treeStateFrom>["nodes"];
  currentLeafId: string | undefined;
  isCompacting: boolean;
  /** In-flight tool output (toolCallId -> text), updated by tool_execution_update. */
  toolOutputs: Record<string, string>;
  /** Pending extension UI requests awaiting user response. */
  extensionUiRequests: ExtensionUiRequest[];
  /** Respond to an extension UI request. */
  respondToExtensionUi: (
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ) => void;
  sendPrompt: (message: string) => Promise<boolean>;
  abortPrompt: () => Promise<void>;
  navigateTree: (entryId: string) => Promise<void>;
}

const maxImmediateTitleLength = 50;

function isUntitledThreadTitle(title: string) {
  return title === "New Thread" || title === "Agent Thread";
}

// ── processEvent — directly mutates the messages array ────

function processEvent(
  e: ThreadServerEvent,
  setMessages: React.Dispatch<React.SetStateAction<TranscriptMessage[]>>,
  setStreaming: (v: boolean) => void,
  setToolOutputs: React.Dispatch<React.SetStateAction<Record<string, string>>>,
) {
  switch (e.type) {
    case "messages":
      setMessages(
        e.messages.map(
          (m): TranscriptMessage => ({
            id: m.id ?? crypto.randomUUID(),
            role: m.role,
            text: m.text,
            ...(m.toolName !== undefined && { toolName: m.toolName }),
            ...(m.isError !== undefined && { isError: m.isError }),
            ...(m.toolCallId !== undefined && { toolCallId: m.toolCallId }),
            ...(m.content !== undefined && { content: m.content }),
          }),
        ),
      );
      setStreaming(false);
      break;

    case "text_delta":
      setStreaming(true);
      setMessages((prev) => upsertStreaming(prev, e.delta, "assistant"));
      break;

    case "thinking_delta":
      setStreaming(true);
      setMessages((prev) => upsertStreaming(prev, e.delta, "thinking"));
      break;

    case "tool_execution_start":
      setStreaming(true);
      setMessages((prev) => [
        ...prev,
        {
          id: e.toolCallId,
          role: "tool",
          text: JSON.stringify(e.args ?? {}, undefined, 2),
          toolName: e.toolName,
        },
      ]);
      setToolOutputs((prev) => ({ ...prev, [e.toolCallId]: "" }));
      break;

    case "tool_execution_update":
      // Replace, not append: each update contains the FULL accumulated output
      setToolOutputs((prev) => ({ ...prev, [e.toolCallId]: e.partialResult }));
      break;

    case "tool_execution_end": {
      const text = extractResultText(e.result);
      if (text) {
        setToolOutputs((prev) => ({ ...prev, [e.toolCallId]: text }));
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === e.toolCallId ? { ...m, isError: e.isError } : m)),
      );
      break;
    }

    case "agent_end":
      setStreaming(false);
      setMessages((prev) =>
        prev.map((m) => (m.id.startsWith("__stream_") ? { ...m, id: crypto.randomUUID() } : m)),
      );
      break;

    case "state_update":
      setStreaming(e.state.isStreaming);
      break;
  }
}

/**
 * Extracts joined text from an SDK tool result: { content: [{ type: "text", text }] }.
 * The result arrives untyped over the wire, so narrow step by step.
 */
function extractResultText(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result)) return "";
  const content = result.content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
    ) {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function upsertStreaming(
  messages: TranscriptMessage[],
  delta: string,
  role: "assistant" | "thinking",
): TranscriptMessage[] {
  const id = `__stream_${role}__`;
  const idx = messages.findIndex((m) => m.id === id);
  if (idx >= 0) {
    const updated: TranscriptMessage = {
      ...(messages[idx] as TranscriptMessage),
      text: (messages[idx] as TranscriptMessage).text + delta,
    };
    return [...messages.slice(0, idx), updated, ...messages.slice(idx + 1)];
  }
  const entry: TranscriptMessage = { id, role, text: delta };
  return [...messages, entry];
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useAgentThreadConnection(
  params: AgentThreadPanelParams,
  options?: { onAutoTitled?: (title: string) => void | Promise<void> },
): UseAgentConnectionResult {
  const [runtimeState, setRuntimeState] = useState<AgentThreadRuntimeState>({ status: "starting" });
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [isStreaming, setStreaming] = useState(false);
  const [model, setModel] = useState<string | undefined>();
  const [treeEntries, setTreeEntries] = useState<TreeEntry[]>([]);
  const [isCompacting, setIsCompacting] = useState(false);
  const [toolOutputs, setToolOutputs] = useState<Record<string, string>>({});
  const [extensionUiRequests, setExtensionUiRequests] = useState<ExtensionUiRequest[]>([]);
  const closedRef = useRef(false);

  const hasAutoTitledRef = useRef(false);
  // eslint-disable-next-line unicorn/no-useless-undefined -- required: no overload for useRef<T>()
  const pendingPromptRef = useRef<string | undefined>(undefined);
  const onAutoTitled = options === undefined ? undefined : options.onAutoTitled;
  const onAutoTitledRef = useRef(onAutoTitled);
  onAutoTitledRef.current = onAutoTitled;
  const messagesRef = useRef<TranscriptMessage[]>([]);
  messagesRef.current = messages;

  const socket = useAppSocket();

  const { nodes: treeNodes, activeLeafId: currentLeafId } = treeStateFrom(treeEntries);

  // Clean up tool outputs on messages snapshot (content blocks replace them)
  useEffect(() => {
    if (messages.some((m) => m.content && m.content.length > 0)) {
      setToolOutputs({});
    }
  }, [messages]);

  // Register project + open thread on mount, close on unmount
  useEffect(() => {
    closedRef.current = false;

    setRuntimeState({ status: "connecting" });

    const init = async () => {
      try {
        const config = await getCloudConfig();
        if (closedRef.current) return;
        socket.send({
          type: "register_project",
          projectPath: params.folderPath,
          projectId: params.projectId,
          sessionId: params.sessionId,
          cloudApiUrl: config.url,
          cloudApiKey: config.api_key,
        });
        socket.send({
          type: "open_thread",
          threadId: params.threadId,
          projectPath: params.folderPath,
          sessionId: params.sessionId,
        });
        setRuntimeState({ status: "ready" });
      } catch {
        if (closedRef.current) return;
        setRuntimeState({ status: "error", message: "Cloud config unavailable" });
      }
    };
    init();

    return () => {
      closedRef.current = true;
    };
  }, [socket, params.threadId, params.folderPath, params.projectId, params.sessionId]);

  // Subscribe to events for this thread
  useEffect(() => {
    const unsub = socket.onEvent((event: ServerEvent) => {
      if (event.type !== "thread_event" || event.threadId !== params.threadId) return;
      const e = event.event;

      switch (e.type) {
        case "error":
          setRuntimeState({ status: "error", message: e.message });
          setStreaming(false);
          break;

        case "state_update":
          setModel(e.state.model);
          setStreaming(e.state.isStreaming);
          break;

        case "tree_data":
          setTreeEntries(e.entries);
          break;

        case "compaction_start":
          setIsCompacting(true);
          break;

        case "compaction_end":
          setIsCompacting(false);
          break;

        case "agent_start":
          setRuntimeState({ status: "sending" });
          processEvent(e, setMessages, setStreaming, setToolOutputs);
          break;

        case "agent_end":
          setRuntimeState({ status: "ready" });
          processEvent(e, setMessages, setStreaming, setToolOutputs);
          settleAutoTitleRef.current();
          break;

        case "extension_ui_request":
          if (e.method === "notify") {
            // Fire-and-forget notifications — could show a toast in the future
            break;
          }
          setExtensionUiRequests((prev) => [
            ...prev,
            {
              id: e.id,
              method: e.method,
              title: e.title,
              ...(e.method === "select" && { options: e.options }),
              ...(e.method === "confirm" && { message: e.message }),
              ...(e.method === "input" && { placeholder: e.placeholder }),
            },
          ]);
          break;

        default:
          processEvent(e, setMessages, setStreaming, setToolOutputs);
          break;
      }
    });
    return unsub;
  }, [socket, params.threadId]);

  const respondToExtensionUi = useCallback(
    (id: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      setExtensionUiRequests((prev) => prev.filter((r) => r.id !== id));
      socket.send({ type: "extension_ui_response", id, ...response });
    },
    [socket],
  );

  const sendPrompt = useCallback(
    async (message: string): Promise<boolean> => {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: message }]);
      socket.send({ type: "prompt", threadId: params.threadId, message });
      armAutoTitleRef.current(message);
      return true;
    },
    [socket, params.threadId],
  );

  const abortPrompt = useCallback(async () => {
    socket.send({ type: "abort", threadId: params.threadId });
  }, [socket, params.threadId]);

  const navigateTree = useCallback(
    async (entryId: string) => {
      socket.send({ type: "navigate_tree", threadId: params.threadId, entryId });
    },
    [socket, params.threadId],
  );

  function armAutoTitle(message: string) {
    if (hasAutoTitledRef.current || !isUntitledThreadTitle(params.title)) {
      return;
    }
    const trimmed = message.trim();
    if (trimmed.length <= maxImmediateTitleLength) {
      hasAutoTitledRef.current = true;
      void applyTitle(trimmed);
    } else if (pendingPromptRef.current === undefined) {
      pendingPromptRef.current = trimmed;
    }
  }

  function settleAutoTitle() {
    const prompt = pendingPromptRef.current;
    if (prompt === undefined) {
      return;
    }
    pendingPromptRef.current = undefined;
    const msgs = messagesRef.current;
    let assistantText = "";
    for (let i = msgs.length - 1; i >= 0; i--) {
      const candidate = msgs[i];
      if (candidate !== undefined && candidate.role === "assistant") {
        assistantText = candidate.text;
        break;
      }
    }
    if (assistantText.length === 0) {
      return;
    }
    void generateTitleFromModel(prompt, assistantText);
  }

  async function generateTitleFromModel(prompt: string, assistantText: string) {
    if (hasAutoTitledRef.current || assistantText.length === 0) {
      return;
    }

    setAgentThreadTitleGenerationState(params.threadId, { status: "generating" });

    const requestId = crypto.randomUUID();
    let title = "";
    try {
      title = await requestOverSocket<string>(
        socket.send,
        socket.onEvent,
        { type: "generate_title", requestId, prompt, assistantText },
        (event: ServerEvent) => {
          if (event.type === "title_generated" && event.requestId === requestId) {
            return event.title;
          }
          if (event.type === "title_generation_failed" && event.requestId === requestId) {
            throw new Error(event.error);
          }
          return;
        },
      );
    } catch {
      // Title generation is cosmetic; silently fail.
    }

    if (title.length > 0 && !hasAutoTitledRef.current) {
      hasAutoTitledRef.current = true;
      await applyTitle(title);
    }
    setAgentThreadTitleGenerationState(params.threadId, { status: "done" });
  }

  async function applyTitle(title: string) {
    const cb = onAutoTitledRef.current;
    if (cb !== undefined) {
      await cb(title);
    }
  }

  const armAutoTitleRef = useRef(armAutoTitle);
  armAutoTitleRef.current = armAutoTitle;
  const settleAutoTitleRef = useRef(settleAutoTitle);
  settleAutoTitleRef.current = settleAutoTitle;

  return {
    messages,
    isStreaming,
    model,
    runtimeState,
    treeNodes,
    currentLeafId,
    isCompacting,
    toolOutputs,
    extensionUiRequests,
    respondToExtensionUi,
    sendPrompt,
    abortPrompt,
    navigateTree,
  };
}
