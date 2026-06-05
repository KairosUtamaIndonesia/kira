import { createFlueClient, type AgentSocket } from "@flue/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentThreadMessageKind,
  AgentThreadMessageRecord,
  AgentThreadPanelParams,
} from "../types";

import {
  listAgentThreadMessages,
  prepareAgentThread,
  saveAgentThreadMessage,
} from "../api/agentRuntimeApi";

type AgentThreadRuntimeState =
  | { status: "starting" }
  | { status: "connecting"; baseUrl: string }
  | { status: "ready"; baseUrl: string }
  | { status: "sending"; baseUrl: string }
  | { status: "error"; message: string }
  | { status: "stopped" };

function useAgentThreadConnection(params: AgentThreadPanelParams) {
  const [runtimeState, setRuntimeState] = useState<AgentThreadRuntimeState>({
    status: "starting",
  });
  const [messages, setMessages] = useState<AgentThreadMessageRecord[]>([]);
  const socketRef = useRef<AgentSocket | undefined>(void 0);
  const runtimeStateRef = useRef(runtimeState);
  const appendQueueRef = useRef(Promise.resolve());
  const pendingPromptRequestIdRef = useRef<string | undefined>(void 0);
  const runtimeRequestIdsRef = useRef(new Map<string, string>());
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
      const appendOperation = appendMessageAfter(previousAppend, params.threadId, kind, requestId, message, (savedMessage) => {
        setMessages((currentMessages) => [...currentMessages, savedMessage]);
      });
      appendQueueRef.current = settleAppendOperation(appendOperation);
      return appendOperation;
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
      pendingPromptRequestIdRef.current = undefined;
      setRuntimeState({ status: "ready", baseUrl: state.baseUrl });
      return true;
    } catch (error) {
      pendingPromptRequestIdRef.current = undefined;
      setRuntimeState({ status: "error", message: errorMessageFromUnknown(error) });
      return false;
    }
  }

  return { messages, runtimeState, sendPrompt };
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
export type { AgentThreadMessageRecord, AgentThreadRuntimeState };
