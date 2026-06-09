import { createFlueClient, type AgentSocket } from "@flue/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentThreadContextUsage,
  AgentThreadMessageKind,
  AgentThreadMessageRecord,
  AgentThreadPanelParams,
} from "../types";

import { setAgentThreadTitleGenerationState } from "../agentThreadStatusStore";
import {
  getAgentThreadContextUsage,
  listAgentThreadMessages,
  prepareAgentThread,
  respondToHumanRequest,
  saveAgentThreadMessage,
} from "../api/agentRuntimeApi";

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

type UseAgentThreadConnectionOptions = {
  onAutoTitled?: (title: string) => void;
};

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
  const [messages, setMessages] = useState<AgentThreadMessageRecord[]>([]);
  const socketRef = useRef<AgentSocket | undefined>(void 0);
  const runtimeStateRef = useRef(runtimeState);
  const appendQueueRef = useRef(Promise.resolve());
  const pendingPromptRequestIdRef = useRef<string | undefined>(void 0);
  const runtimeRequestIdsRef = useRef(new Map<string, string>());
  const hasAutoTitledRef = useRef(false);
  const isFirstPromptRef = useRef(true);
  const runtimeInfoRef = useRef<{ baseUrl: string; token: string } | undefined>(void 0);
  const onAutoTitledRef = useRef(options === undefined ? undefined : options.onAutoTitled);
  onAutoTitledRef.current = options === undefined ? undefined : options.onAutoTitled;
  runtimeStateRef.current = runtimeState;

  const runtimeInput = useMemo(
    () => ({
      projectId: params.projectId,
      sessionId: params.sessionId,
      threadId: params.threadId,
    }),
    [params.projectId, params.sessionId, params.threadId],
  );

  const appendMessage = useCallback(
    (kind: AgentThreadMessageKind, requestId: string, message: unknown) => {
      const previousAppend = appendQueueRef.current;
      const appendOperation = appendMessageAfter(
        previousAppend,
        params.threadId,
        kind,
        requestId,
        message,
        (savedMessage) => {
          setMessages((currentMessages) => [...currentMessages, savedMessage]);
        },
      );
      appendQueueRef.current = settleAppendOperation(appendOperation);
      return appendOperation;
    },
    [params.threadId],
  );

  const respondToRequest = useCallback(
    async (response: unknown): Promise<boolean> => {
      try {
        await respondToHumanRequest({ threadId: params.threadId, response });
        return true;
      } catch {
        return false;
      }
    },
    [params.threadId],
  );

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let socket: AgentSocket | undefined;

    async function connectRuntime() {
      try {
        runtimeRequestIdsRef.current = new Map();
        pendingPromptRequestIdRef.current = undefined;
        const loadedMessages = await listAgentThreadMessages({ threadId: params.threadId });
        if (disposed) {
          return;
        }
        setMessages(loadedMessages);

        const runtime = await prepareAgentThread(runtimeInput);
        if (disposed) {
          return;
        }
        runtimeInfoRef.current = { baseUrl: runtime.baseUrl, token: runtime.token };

        setRuntimeState({ status: "connecting", baseUrl: runtime.baseUrl });
        const client = createFlueClient({
          baseUrl: runtime.baseUrl,
          token: runtime.token,
          websocketUrl: (url) => {
            url.searchParams.set("token", runtime.token);
            return url;
          },
        });

        socket = client.agents.connect("coding", params.threadId);
        socketRef.current = socket;
        unsubscribe = socket.onEvent((event, context) => {
          const requestId = requestIdForRuntimeEvent(
            context.requestId,
            runtimeRequestIdsRef.current,
            pendingPromptRequestIdRef.current,
          );
          void appendMessage("event", requestId, event);
        });
        await socket.ready;

        if (!disposed) {
          setRuntimeState({ status: "ready", baseUrl: runtime.baseUrl });
          await refreshContextUsage(params.threadId, setContextUsageState);
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
      if (socket !== undefined) {
        socket.close(1000, "Agent Thread panel closed.");
      }
      if (socketRef.current === socket) {
        socketRef.current = undefined;
      }
    };
  }, [appendMessage, params.threadId, runtimeInput]);

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
      const requestId = crypto.randomUUID();
      pendingPromptRequestIdRef.current = requestId;
      await appendMessage("prompt", requestId, message);
      const result = await socket.prompt(message, { session: "default" });
      await appendMessage("result", requestId, result.result);

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
          void generateTitleFromModel(trimmedPrompt, result.result);
        }
      }

      await refreshContextUsage(params.threadId, setContextUsageState);
      pendingPromptRequestIdRef.current = undefined;
      setRuntimeState({ status: "ready", baseUrl: state.baseUrl });
      return true;
    } catch (error) {
      pendingPromptRequestIdRef.current = undefined;
      setRuntimeState({ status: "error", message: errorMessageFromUnknown(error) });
      return false;
    }
  }

  async function generateTitleFromModel(prompt: string, assistantResult: unknown) {
    if (hasAutoTitledRef.current) {
      return;
    }
    const runtime = runtimeInfoRef.current;
    if (runtime === undefined) {
      return;
    }

    setTitleGenerationState({ status: "generating" });
    setAgentThreadTitleGenerationState(params.threadId, { status: "generating" });
    const generationStartedAt = performance.now();
    let generatedTitle = "";
    let titleSocket: AgentSocket | undefined;

    try {
      const client = createFlueClient({
        baseUrl: runtime.baseUrl,
        token: runtime.token,
        websocketUrl: (url) => {
          url.searchParams.set("token", runtime.token);
          return url;
        },
      });

      titleSocket = client.agents.connect("title-generator", `title-gen-${crypto.randomUUID()}`);
      await titleSocket.ready;

      const formatted = `User prompt:\n${prompt}\n\nAssistant response:\n${JSON.stringify(assistantResult, undefined, 2)}`;
      const titleResult = await titleSocket.prompt(formatted, { session: "default" });
      generatedTitle = extractTextFromUnknown(titleResult.result).trim();
    } catch {
      // Title generation is cosmetic; silently fail.
    } finally {
      if (titleSocket !== undefined) {
        titleSocket.close();
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
  }

  return {
    contextUsageState,
    messages,
    respondToRequest,
    runtimeState,
    sendPrompt,
    titleGenerationState,
  };
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "content", "markdown", "message", "result", "output"]) {
      const candidate = record[key];
      if (typeof candidate === "string") {
        return candidate;
      }
    }
  }

  return "";
}

function isUntitledAgentThreadTitle(title: string) {
  return title === "New Thread" || title === "Agent Thread";
}

async function waitForMinimumTitleGenerationDuration(startedAt: number) {
  const remainingMs = minimumTitleGenerationVisibleMs - (performance.now() - startedAt);
  if (remainingMs <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, remainingMs));
}

async function refreshContextUsage(
  threadId: string,
  setContextUsageState: (state: AgentThreadContextUsageState) => void,
) {
  try {
    const usage = await getAgentThreadContextUsage({ threadId });
    setContextUsageState(usage === null ? { status: "empty" } : { status: "ready", usage });
  } catch (error) {
    setContextUsageState({ status: "error", message: errorMessageFromUnknown(error) });
  }
}

async function appendMessageAfter(
  previousAppend: Promise<void>,
  threadId: string,
  kind: AgentThreadMessageKind,
  requestId: string,
  message: unknown,
  appendSavedMessage: (message: AgentThreadMessageRecord) => void,
) {
  await previousAppend;
  const savedMessage = await saveAgentThreadMessage({
    threadId,
    kind,
    requestId,
    message,
  });
  appendSavedMessage(savedMessage);
}

async function settleAppendOperation(appendOperation: Promise<void>) {
  try {
    await appendOperation;
  } catch {
    return;
  }
}

function requestIdForRuntimeEvent(
  runtimeRequestId: string,
  runtimeRequestIds: Map<string, string>,
  pendingPromptRequestId: string | undefined,
) {
  const existingRequestId = runtimeRequestIds.get(runtimeRequestId);
  if (existingRequestId !== undefined) {
    return existingRequestId;
  }

  if (pendingPromptRequestId === undefined) {
    return runtimeRequestId;
  }

  runtimeRequestIds.set(runtimeRequestId, pendingPromptRequestId);
  return pendingPromptRequestId;
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

export { useAgentThreadConnection };
export type {
  AgentThreadContextUsageState,
  AgentThreadMessageRecord,
  AgentThreadRuntimeState,
  AgentThreadTitleGenerationState,
};
