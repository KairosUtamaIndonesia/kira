import { createFlueClient, type AgentSocket } from "@flue/sdk";
import { Loader2, Send } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import type { AgentThreadPanelParams } from "../types";

import { prepareAgentThread } from "../api/agentRuntimeApi";

type AgentThreadPanelProps = {
  params: AgentThreadPanelParams;
};

type AgentThreadRuntimeState =
  | { status: "starting" }
  | { status: "connecting"; baseUrl: string }
  | { status: "ready"; baseUrl: string }
  | { status: "sending"; baseUrl: string }
  | { status: "error"; message: string }
  | { status: "stopped" };

type AgentThreadMessageRecord = {
  id: string;
  receivedAt: string;
  kind: "event" | "result";
  requestId: string;
  message: unknown;
};

function AgentThreadPanel({ params }: AgentThreadPanelProps) {
  const [runtimeState, setRuntimeState] = useState<AgentThreadRuntimeState>({
    status: "starting",
  });
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AgentThreadMessageRecord[]>([]);
  const messageSequenceRef = useRef(0);
  const socketRef = useRef<AgentSocket | undefined>(void 0);
  const runtimeStateRef = useRef(runtimeState);
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
    (kind: AgentThreadMessageRecord["kind"], requestId: string, message: unknown) => {
      messageSequenceRef.current += 1;
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `${params.threadId}:${messageSequenceRef.current}`,
          receivedAt: new Date().toISOString(),
          kind,
          requestId,
          message,
        },
      ]);
    },
    [params.threadId],
  );

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let socket: AgentSocket | undefined;

    async function connectRuntime() {
      try {
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
          appendMessage("event", context.requestId, event);
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = prompt.trim();
    if (message.length === 0) {
      return;
    }

    const state = runtimeStateRef.current;
    if (state.status !== "ready" && state.status !== "sending") {
      return;
    }

    const socket = socketRef.current;
    if (socket === undefined) {
      setRuntimeState({ status: "error", message: "Agent Thread socket is not connected." });
      return;
    }

    setRuntimeState({ status: "sending", baseUrl: state.baseUrl });
    try {
      const result = await socket.prompt(message, { session: "default" });
      appendMessage("result", "result", result.result);
      setPrompt("");
      setRuntimeState({ status: "ready", baseUrl: state.baseUrl });
    } catch (error) {
      setRuntimeState({ status: "error", message: errorMessageFromUnknown(error) });
    }
  }

  const canSend = runtimeState.status === "ready" || runtimeState.status === "sending";
  const isSending = runtimeState.status === "sending";

  return (
    <section className="flex h-full min-h-0 flex-col bg-editor-surface text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">Agent Thread</div>
          <div className="truncate font-mono text-xs text-muted-foreground">{params.threadId}</div>
        </div>
        <AgentThreadStatus state={runtimeState} />
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-40 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Flue SDK events will appear here after this Agent Thread connects or responds.
          </div>
        ) : (
          <ol className="space-y-3">
            {messages.map((message) => (
              <li key={message.id} className="space-y-1">
                <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <span>{formatTimestamp(message.receivedAt)}</span>
                  <span>{message.kind}</span>
                  <span>{message.requestId}</span>
                </div>
                <pre className="max-h-80 overflow-auto rounded-md border border-border bg-card p-2 font-mono text-xs text-card-foreground">
                  {stringifyMessage(message.message)}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </div>
      <form
        className="shrink-0 border-t border-border p-3"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="space-y-2">
          <Textarea
            value={prompt}
            rows={4}
            placeholder="Send a prompt to this Agent Thread…"
            disabled={!canSend || isSending}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Press Enter to send. Use Shift+Enter for a new line.
            </p>
            <Button type="submit" disabled={!canSend || isSending || prompt.trim().length === 0}>
              {isSending ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Send aria-hidden="true" />
              )}
              {sendButtonLabel(runtimeState)}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}

function AgentThreadStatus({ state }: { state: AgentThreadRuntimeState }) {
  if (state.status === "starting") {
    return (
      <output className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        Starting runtime…
      </output>
    );
  }

  if (state.status === "connecting") {
    return (
      <output className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        Connecting…
      </output>
    );
  }

  if (state.status === "ready" || state.status === "sending") {
    return (
      <output className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
        {state.baseUrl}
      </output>
    );
  }

  if (state.status === "error") {
    return (
      <output
        role="alert"
        className="max-w-80 truncate rounded-full border border-border px-2 py-1 text-xs text-destructive"
      >
        {state.message}
      </output>
    );
  }

  return (
    <output className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
      Stopped
    </output>
  );
}

function sendButtonLabel(state: AgentThreadRuntimeState) {
  if (state.status === "starting" || state.status === "connecting") {
    return "Starting…";
  }

  if (state.status === "sending") {
    return "Sending…";
  }

  return "Send";
}

function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey) {
    return;
  }

  event.preventDefault();
  const form = event.currentTarget.form;
  if (form instanceof HTMLFormElement) {
    form.requestSubmit();
  }
}

function stringifyMessage(message: unknown) {
  try {
    return JSON.stringify(message, undefined, 2);
  } catch {
    return String(message);
  }
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
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

export { AgentThreadPanel };
