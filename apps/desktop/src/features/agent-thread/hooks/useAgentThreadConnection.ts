import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSkillsList } from "@/features/skills/hooks/useSkillsList";

import type {
  AgentThreadContextUsage,
  AgentThreadPanelParams,
  AgentThreadTree,
  SessionTreeNodeJson,
  PiMessage,
  PiTranscriptState,
} from "../types";

import { setAgentThreadTitleGenerationState } from "../agentThreadStatusStore";
import {
  generateAgentThreadTitle,
  getAgentThreadContextUsage,
  prepareAgentThread,
} from "../api/agentRuntimeApi";
import { expandSlashCommandInText } from "../expandUserMessage";
import {
  appendLocalUserMessage,
  applyPiEvent,
  emptyPiTranscriptState,
  hydratePiTranscript,
} from "../piTranscriptState";

declare global {
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }
}

type AgentThreadRuntimeState =
  | { status: "starting" }
  | { status: "connecting"; baseUrl: string }
  | { status: "ready"; baseUrl: string }
  | { status: "sending"; baseUrl: string }
  | { status: "error"; message: string }
  | { status: "stopped" };

type AgentThreadContextUsageState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; usage: AgentThreadContextUsage }
  | { status: "error"; message: string };

type AgentThreadTitleGenerationState =
  | { status: "idle" }
  | { status: "generating" }
  | { status: "done" };

type CompactionSummary = {
  tokensBefore: number;
  summary: string;
  timestamp: number;
};

type UseAgentThreadConnectionOptions = {
  onAutoTitled?: (title: string) => void;
};

type PiCommandResponse = {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  error?: string;
  data?: unknown;
};

type PendingCommand<TResponse = PiCommandResponse> = {
  resolve: (response: TResponse) => void;
  reject: (error: Error) => void;
};

type ActivePrompt = {
  id: string;
  parts: string[];
  resolve: (text: string) => void;
  reject: (error: Error) => void;
};

type PiEventListener = (event: unknown) => void;

class AbortError extends Error {
  readonly name = "AbortError";
}

const minimumTitleGenerationVisibleMs = 1200;

function useAgentThreadConnection(
  params: AgentThreadPanelParams,
  options?: UseAgentThreadConnectionOptions,
) {
  const [runtimeState, setRuntimeState] = useState<AgentThreadRuntimeState>({
    status: "starting",
  });
  const [contextUsageState, setContextUsageState] = useState<AgentThreadContextUsageState>({
    status: "loading",
  });
  const [titleGenerationState, setTitleGenerationState] = useState<AgentThreadTitleGenerationState>(
    {
      status: "idle",
    },
  );
  const [transcript, setTranscript] = useState(emptyPiTranscriptState);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactionSummary, setCompactionSummary] = useState<CompactionSummary>();
  const [treeNodes, setTreeNodes] = useState<SessionTreeNodeJson[]>([]);
  const [currentLeafId, setCurrentLeafId] = useState<string>();
  const treeDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(void 0);
  const isCompactingRef = useRef(false);
  const socketRef = useRef<PiAgentSocket | undefined>(void 0);
  const runtimeStateRef = useRef(runtimeState);
  const runtimeInfoRef = useRef<{ baseUrl: string; token: string } | undefined>(void 0);
  const skillsList = useSkillsList(params.folderPath);
  const hasAutoTitledRef = useRef(false);
  const isFirstPromptRef = useRef(true);
  const onAutoTitledRef = useRef(options === undefined ? undefined : options.onAutoTitled);
  onAutoTitledRef.current = options === undefined ? undefined : options.onAutoTitled;
  runtimeStateRef.current = runtimeState;
  isCompactingRef.current = isCompacting;
  // Stable ref to the Pi event handler — avoids capturing stale deps in effect subscriptions.
  const handlePiEventRef = useRef<PiEventListener | null>(null);
  handlePiEventRef.current = function handlePiEvent(event: unknown) {
    setTranscript((currentTranscript) => applyPiEvent(currentTranscript, event));
    if (isRecord(event)) {
      if (event.type === "compaction_start") {
        setIsCompacting(true);
      } else if (event.type === "compaction_end") {
        setIsCompacting(false);
        if (event.result !== undefined && isRecord(event.result)) {
          const result = event.result;
          const summary = typeof result.summary === "string" ? result.summary : undefined;
          const tokensBefore =
            typeof result.tokensBefore === "number" ? result.tokensBefore : undefined;
          if (summary !== undefined && tokensBefore !== undefined) {
            setCompactionSummary({ tokensBefore, summary, timestamp: Date.now() });
          }
        }
      }
      if (event.type === "message_end" || event.type === "turn_end" || event.type === "settled") {
        scheduleTreeRefresh();
      }
    }
  };

  function scheduleTreeRefresh() {
    if (treeDebounceRef.current !== undefined) {
      clearTimeout(treeDebounceRef.current);
    }
    treeDebounceRef.current = setTimeout(async () => {
      const runtime = runtimeInfoRef.current;
      if (runtime === undefined) {
        return;
      }
      try {
        const result = await fetchPiTree(runtime.baseUrl, runtime.token, params.threadId);
        setTreeNodes(result.nodes);
        setCurrentLeafId(result.currentLeafId);
        setTranscript((current) =>
          applyPiEvent(current, {
            type: "tree_updated",
            nodes: result.nodes,
            currentLeafId: result.currentLeafId,
          }),
        );
      } catch {
        // Tree fetch is a UI enhancement; silently ignore errors.
      }
    }, 500);
  }

  const runtimeInput = useMemo(
    () => ({
      projectId: params.projectId,
      sessionId: params.sessionId,
      threadId: params.threadId,
    }),
    [params.projectId, params.sessionId, params.threadId],
  );

  const respondToRequest = useCallback(
    async (requestId: string, response: unknown): Promise<boolean> => {
      const socket = socketRef.current;
      if (socket === undefined) {
        return false;
      }
      try {
        await socket.respondToToolUi(requestId, response);
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let socket: PiAgentSocket | undefined;
    async function connectRuntime() {
      try {
        const runtime = await prepareAgentThread(runtimeInput);
        if (disposed) {
          return;
        }
        runtimeInfoRef.current = { baseUrl: runtime.baseUrl, token: runtime.token };
        // Fetch tree data on mount (fire-and-forget, non-critical).
        try {
          const result = await fetchPiTree(runtime.baseUrl, runtime.token, params.threadId);
          if (!disposed) {
            setTreeNodes(result.nodes);
            setCurrentLeafId(result.currentLeafId);
            setTranscript((current) =>
              applyPiEvent(current, {
                type: "tree_updated",
                nodes: result.nodes,
                currentLeafId: result.currentLeafId,
              }),
            );
          }
        } catch {
          // Tree fetch is a UI enhancement; silently ignore errors.
        }

        const session = await loadPiSession(runtime.baseUrl, runtime.token, params.threadId);
        if (disposed) {
          return;
        }

        setTranscript(hydratePiTranscript(session.messages));
        setContextUsageState(
          session.contextUsage === undefined
            ? { status: "empty" }
            : { status: "ready", usage: session.contextUsage },
        );
        if (session.compaction !== undefined) {
          setCompactionSummary({ ...session.compaction, timestamp: Date.now() });
        }
        setRuntimeState({ status: "connecting", baseUrl: runtime.baseUrl });
        socket = PiAgentSocket.connect({
          baseUrl: runtime.baseUrl,
          token: runtime.token,
          threadId: params.threadId,
        });
        socketRef.current = socket;
        unsubscribe = socket.onEvent((event) => {
          const handler = handlePiEventRef.current;
          if (handler !== null) handler(event);
        });
        await socket.ready;

        if (!disposed) {
          setRuntimeState({ status: "ready", baseUrl: runtime.baseUrl });
          await refreshContextUsage(params.threadId, setContextUsageState, runtime);
        }
      } catch (error) {
        if (!disposed) {
          setRuntimeState({ status: "error", message: errorMessageFromUnknown(error) });
        }
      }
    }

    void connectRuntime();

    return () => {
      disposed = true;
      if (unsubscribe !== undefined) {
        unsubscribe();
      }
      if (treeDebounceRef.current !== undefined) {
        clearTimeout(treeDebounceRef.current);
      }
      if (socket !== undefined) {
        socket.close(1000, "Agent Thread panel closed.");
      }
      if (socketRef.current === socket) {
        socketRef.current = undefined;
      }
    };
  }, [params.threadId, runtimeInput]);
  async function sendPrompt(message: string) {
    const state = runtimeStateRef.current;
    if (state.status !== "ready" && state.status !== "sending") {
      return false;
    }

    const socket = socketRef.current;
    if (socket === undefined) {
      setRuntimeState({ status: "error", message: "Agent Thread socket is not connected." });
      return false;
    }
    setRuntimeState({ status: "sending", baseUrl: state.baseUrl });
    try {
      const expanded = await expandForLocalTranscript(message, params.folderPath, skillsList);
      setTranscript((currentTranscript) => appendLocalUserMessage(currentTranscript, expanded));
      const result = await socket.prompt(expanded);

      if (
        isFirstPromptRef.current &&
        !hasAutoTitledRef.current &&
        isUntitledAgentThreadTitle(params.title)
      ) {
        isFirstPromptRef.current = false;
        const trimmedPrompt = message.trim();
        if (trimmedPrompt.length <= 50) {
          hasAutoTitledRef.current = true;
          const onAutoTitled = onAutoTitledRef.current;
          if (onAutoTitled !== undefined) {
            onAutoTitled(trimmedPrompt);
          }
        } else {
          void generateTitleFromModel(trimmedPrompt, result);
        }
      }
      const runtimeInfo = runtimeInfoRef.current;
      if (runtimeInfo === undefined) {
        throw new Error("Agent Thread runtime connection is missing.");
      }

      await refreshContextUsage(params.threadId, setContextUsageState, {
        baseUrl: state.baseUrl,
        token: runtimeInfo.token,
      });
      setRuntimeState({ status: "ready", baseUrl: state.baseUrl });
      return true;
    } catch (error) {
      if (!(error instanceof AbortError)) {
        setRuntimeState({ status: "error", message: errorMessageFromUnknown(error) });
      }
      return false;
    }
  }
  async function abortPrompt() {
    const socket = socketRef.current;
    if (socket === undefined) return;
    const state = runtimeStateRef.current;
    if (state.status !== "sending") return;
    try {
      await socket.abort();
    } catch {
      // Abort command failure shouldn't leave the thread stuck in "sending".
      // State is set to "ready" regardless; the agent will settle naturally.
    }
    setRuntimeState({ status: "ready", baseUrl: state.baseUrl });
  }
  async function switchModel(modelLabel: string) {
    const socket = socketRef.current;
    if (socket === undefined) {
      return;
    }
    try {
      await socket.switchModel(modelLabel);
    } catch {
      // Model switch failure is informational; the session continues with the
      // previous model.
    }
  }

  async function navigateTree(entryId: string) {
    const socket = socketRef.current;
    const runtime = runtimeInfoRef.current;
    if (socket === undefined || runtime === undefined) {
      return;
    }
    try {
      await socket.navigateTree(entryId);
      // Reload session — backend now returns messages for the new branch only.
      const [treeResult, session] = await Promise.all([
        fetchPiTree(runtime.baseUrl, runtime.token, params.threadId),
        loadPiSession(runtime.baseUrl, runtime.token, params.threadId),
      ]);
      setTreeNodes(treeResult.nodes);
      setCurrentLeafId(treeResult.currentLeafId);
      setTranscript(hydratePiTranscript(session.messages));
      setTranscript((current) =>
        applyPiEvent(current, {
          type: "tree_updated",
          nodes: treeResult.nodes,
          currentLeafId: treeResult.currentLeafId,
        }),
      );
    } catch {
      // Navigation failure is informational; the session state is unchanged.
    }
  }

  async function generateTitleFromModel(prompt: string, assistantResult: string) {
    if (hasAutoTitledRef.current) {
      return;
    }

    setTitleGenerationState({ status: "generating" });
    setAgentThreadTitleGenerationState(params.threadId, { status: "generating" });
    const generationStartedAt = performance.now();
    let generatedTitle = "";

    try {
      generatedTitle = await generateAgentThreadTitle({
        projectId: params.projectId,
        sessionId: params.sessionId,
        threadId: params.threadId,
        prompt,
        assistantText: assistantResult,
      });
    } catch {
      // Title generation is cosmetic; silently fail.
    }

    await waitForMinimumTitleGenerationDuration(generationStartedAt);
    if (generatedTitle.length > 0 && !hasAutoTitledRef.current) {
      hasAutoTitledRef.current = true;
      const onAutoTitled = onAutoTitledRef.current;
      if (onAutoTitled !== undefined) {
        await onAutoTitled(generatedTitle);
      }
    }
    setTitleGenerationState({ status: "done" });
    setAgentThreadTitleGenerationState(params.threadId, { status: "done" });
  }

  async function runSlashCommandAction(
    _kind: "compact",
    args: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (isCompactingRef.current) {
      return { ok: false, error: "Already compacting." };
    }
    const socket = socketRef.current;
    if (socket === undefined) {
      return { ok: false, error: "Agent Thread socket is not connected." };
    }
    const state = runtimeStateRef.current;
    if (state.status !== "ready") {
      return { ok: false, error: "Agent Thread is not ready." };
    }
    try {
      await socket.compact(args);
      scheduleTreeRefresh();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessageFromUnknown(error) };
    }
  }

  return {
    contextUsageState,
    compactionSummary,
    isCompacting,
    runSlashCommandAction,
    transcript,
    treeNodes,
    currentLeafId,
    respondToRequest,
    abortPrompt,
    runtimeState,
    sendPrompt,
    navigateTree,
    switchModel,
    titleGenerationState,
  };
}

class PiAgentSocket {
  readonly ready: Promise<void>;
  private readonly socket: WebSocket;
  private readonly listeners = new Set<PiEventListener>();
  private readonly pendingCommands = new Map<string, PendingCommand>();
  private aborted = false;
  private activePrompt: ActivePrompt | undefined;

  private constructor(socket: WebSocket, ready: Promise<void>) {
    this.socket = socket;
    this.ready = ready;
    this.socket.addEventListener("message", (event) => this.handleMessage(event));
    this.socket.addEventListener("close", () => this.rejectPending("Agent Thread socket closed."));
    this.socket.addEventListener("error", () => this.rejectPending("Agent Thread socket failed."));
  }

  static connect(input: { baseUrl: string; token: string; threadId: string }) {
    const url = agentSocketUrl(input.baseUrl, input.threadId, input.token);
    const socket = new WebSocket(url);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("Agent Thread socket failed to connect.")),
      { once: true },
    );
    return new PiAgentSocket(socket, promise);
  }

  onEvent(listener: PiEventListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(code?: number, reason?: string) {
    this.socket.close(code, reason);
  }

  async prompt(message: string) {
    this.aborted = false;
    const id = crypto.randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    this.activePrompt = { id, parts: [], resolve, reject };
    await this.sendCommand({ id, type: "prompt", message });
    return promise;
  }

  async abort() {
    this.aborted = true;
    const id = crypto.randomUUID();
    await this.sendCommand({ id, type: "abort" });
    const activePrompt = this.activePrompt;
    if (activePrompt !== undefined) {
      this.activePrompt = undefined;
      activePrompt.reject(new AbortError("Agent response interrupted by user."));
    }
  }
  respondToToolUi(requestId: string, response: unknown) {
    return this.sendCommand({ id: requestId, type: "tool_ui_response", response });
  }
  async navigateTree(
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ) {
    const id = crypto.randomUUID();
    const command: {
      id: string;
      type: string;
      targetId: string;
      options?: Record<string, unknown>;
    } = { id, type: "navigate_tree", targetId };
    if (options !== undefined) {
      command.options = options;
    }
    await this.sendCommand(command);
  }
  async compact(customInstructions: string | undefined) {
    const id = crypto.randomUUID();
    await this.sendCommand({
      id,
      type: "compact",
      ...(customInstructions === undefined ? {} : { customInstructions }),
    });
  }

  /** Switch the active model for this agent session. */
  async switchModel(modelLabel: string) {
    const id = crypto.randomUUID();
    await this.sendCommand({ id, type: "switch_model", modelLabel });
  }
  private sendCommand(command: {
    id: string;
    type: string;
    message?: string;
    response?: unknown;
    targetId?: string;
    options?: Record<string, unknown>;
    customInstructions?: string;
    modelLabel?: string;
  }) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Agent Thread socket is not open."));
    }

    const { promise, resolve, reject } = Promise.withResolvers<PiCommandResponse>();
    this.pendingCommands.set(command.id, { resolve, reject });
    this.socket.send(JSON.stringify(command));
    return promise.then((response) => {
      if (!response.success) {
        throw new Error(response.error ?? `Agent command ${command.type} failed.`);
      }
      return response;
    });
  }

  private handleMessage(event: MessageEvent) {
    const payload = parseSocketPayload(event.data);
    if (payload === undefined) {
      return;
    }
    if (isPiCommandResponse(payload)) {
      this.handleResponse(payload);
      return;
    }
    if (this.aborted) {
      return;
    }
    if (isPromptError(payload)) {
      this.rejectActivePrompt(payload.message);
      this.emit(payload);
      return;
    }
    this.collectPromptText(payload);
    this.emit(payload);
    if (isSettledEvent(payload)) {
      this.resolveActivePrompt();
    }
  }
  private handleResponse(response: PiCommandResponse) {
    const id = response.id;
    if (id === undefined) {
      return;
    }
    const pending = this.pendingCommands.get(id);
    if (pending === undefined) {
      return;
    }
    this.pendingCommands.delete(id);
    pending.resolve(response);
  }

  private emit(event: unknown) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private collectPromptText(event: unknown) {
    const activePrompt = this.activePrompt;
    if (activePrompt === undefined || !isRecord(event)) {
      return;
    }
    const text = textDeltaFromEvent(event);
    if (text !== undefined) {
      activePrompt.parts.push(text);
    }
  }

  private resolveActivePrompt() {
    const activePrompt = this.activePrompt;
    if (activePrompt === undefined) {
      return;
    }
    this.activePrompt = undefined;
    activePrompt.resolve(activePrompt.parts.join(""));
  }

  private rejectActivePrompt(message: string) {
    const activePrompt = this.activePrompt;
    if (activePrompt === undefined) {
      return;
    }
    this.activePrompt = undefined;
    activePrompt.reject(new Error(message));
  }

  private rejectPending(message: string) {
    const error = new Error(message);
    for (const pending of this.pendingCommands.values()) {
      pending.reject(error);
    }
    this.pendingCommands.clear();
    const activePrompt = this.activePrompt;
    if (activePrompt !== undefined) {
      this.activePrompt = undefined;
      activePrompt.reject(error);
    }
  }
}

function agentSocketUrl(baseUrl: string, threadId: string, token: string) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/agents/${encodeURIComponent(threadId)}/ws`;
  url.searchParams.set("token", token);
  return url;
}

function parseSocketPayload(data: unknown) {
  if (typeof data !== "string") {
    return;
  }
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return;
  }
}

function isPiCommandResponse(value: unknown): value is PiCommandResponse {
  return isRecord(value) && value.type === "response" && typeof value.command === "string";
}

function isPromptError(value: unknown): value is { type: "error"; message: string } {
  return isRecord(value) && value.type === "error" && typeof value.message === "string";
}

function isSettledEvent(value: unknown) {
  return (
    isRecord(value) &&
    (value.type === "agent_end" || value.type === "settled" || value.type === "turn_complete")
  );
}

function textDeltaFromEvent(value: Record<string, unknown>) {
  if (value.type === "message_update" && isRecord(value.assistantMessageEvent)) {
    return textDeltaFromEvent(value.assistantMessageEvent);
  }
  if (value.type === "text_delta") {
    const delta = value.delta;
    if (typeof delta === "string") {
      return delta;
    }
    const text = value.text;
    return typeof text === "string" ? text : undefined;
  }
  if (value.type === "message_delta" && typeof value.delta === "string") {
    return value.delta;
  }
  if (value.type === "message" && typeof value.text === "string") {
    return value.text;
  }
  return;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isUntitledAgentThreadTitle(title: string) {
  return title === "New Thread" || title === "Agent Thread";
}
async function waitForMinimumTitleGenerationDuration(startedAt: number) {
  const remainingMs = minimumTitleGenerationVisibleMs - (performance.now() - startedAt);
  if (remainingMs <= 0) {
    return;
  }

  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, remainingMs);
  await promise;
}

async function refreshContextUsage(
  threadId: string,
  setContextUsageState: (state: AgentThreadContextUsageState) => void,
  runtime: { baseUrl: string; token: string },
) {
  try {
    const sessionUsage = await waitForPiSessionContextUsage(
      runtime.baseUrl,
      runtime.token,
      threadId,
    );
    if (sessionUsage !== undefined) {
      setContextUsageState({ status: "ready", usage: sessionUsage });
      return;
    }

    const usage = await getAgentThreadContextUsage({ threadId });
    setContextUsageState(usage === null ? { status: "empty" } : { status: "ready", usage });
  } catch (error) {
    setContextUsageState({ status: "error", message: errorMessageFromUnknown(error) });
  }
}

async function waitForPiSessionContextUsage(
  baseUrl: string,
  token: string,
  threadId: string,
): Promise<AgentThreadContextUsage | undefined> {
  return waitForPiSessionContextUsageAttempt(baseUrl, token, threadId, [0, 100, 250, 500, 1000]);
}

async function waitForPiSessionContextUsageAttempt(
  baseUrl: string,
  token: string,
  threadId: string,
  retryDelaysMs: number[],
): Promise<AgentThreadContextUsage | undefined> {
  const [delayMs, ...remainingDelaysMs] = retryDelaysMs;
  if (delayMs === undefined) {
    return undefined;
  }

  if (delayMs > 0) {
    await delay(delayMs);
  }

  const session = await loadPiSession(baseUrl, token, threadId);
  if (session.contextUsage !== undefined) {
    return session.contextUsage;
  }

  return waitForPiSessionContextUsageAttempt(baseUrl, token, threadId, remainingDelaysMs);
}

async function delay(durationMs: number) {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, durationMs);
  await promise;
}

type PiSessionPayload = {
  messages: PiMessage[];
  contextUsage: AgentThreadContextUsage | undefined;
  compaction: { tokensBefore: number; summary: string } | undefined;
};

function fetchPiTree(baseUrl: string, token: string, threadId: string): Promise<AgentThreadTree> {
  return fetch(`${baseUrl}/app/agent-threads/${encodeURIComponent(threadId)}/tree`, {
    headers: { authorization: `Bearer ${token}` },
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to fetch Pi tree: ${response.status}`);
    }
    const payload = (await response.json()) as { nodes?: unknown; currentLeafId?: unknown };
    return {
      nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
      currentLeafId: typeof payload.currentLeafId === "string" ? payload.currentLeafId : undefined,
    } satisfies AgentThreadTree;
  });
}

async function loadPiSession(
  baseUrl: string,
  token: string,
  threadId: string,
): Promise<PiSessionPayload> {
  const response = await fetch(
    `${baseUrl}/app/agent-threads/${encodeURIComponent(threadId)}/session`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to load Pi session: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    messages?: unknown[];
    contextUsage?: unknown;
    compaction?: unknown;
  };
  const compaction = isCompactionSummary(payload.compaction) ? payload.compaction : undefined;
  return {
    messages: Array.isArray(payload.messages)
      ? payload.messages.filter((message): message is PiMessage => isRecord(message))
      : [],
    contextUsage: isAgentThreadContextUsage(payload.contextUsage)
      ? payload.contextUsage
      : undefined,
    compaction,
  };
}
function isAgentThreadContextUsage(value: unknown): value is AgentThreadContextUsage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.usedTokens === "number" &&
    typeof value.contextWindow === "number" &&
    typeof value.maxOutputTokens === "number" &&
    typeof value.modelId === "string" &&
    isRecord(value.usage) &&
    isRecord(value.cost)
  );
}

function isCompactionSummary(value: unknown): value is { tokensBefore: number; summary: string } {
  return (
    isRecord(value) && typeof value.tokensBefore === "number" && typeof value.summary === "string"
  );
}

function errorMessageFromUnknown(error: unknown) {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Agent Thread runtime failed.";
}

type SkillsListHookState = ReturnType<typeof useSkillsList>;

async function expandForLocalTranscript(
  message: string,
  projectPath: string,
  skillsList: SkillsListHookState,
): Promise<string> {
  if (skillsList.state.status !== "ready") {
    return message;
  }
  const { bundled, project } = skillsList.state.result;
  return expandSlashCommandInText(message, {
    projectPath,
    skills: [...bundled, ...project],
  });
}

export { useAgentThreadConnection };
export type {
  AgentThreadContextUsageState,
  AgentThreadRuntimeState,
  AgentThreadTitleGenerationState,
  PiTranscriptState,
};
