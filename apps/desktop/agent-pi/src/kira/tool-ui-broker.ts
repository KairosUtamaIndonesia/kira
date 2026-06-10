import { uuidv7 } from "@earendil-works/pi-agent-core";
import { WebSocket, type WebSocket as WebSocketInstance } from "ws";

type ToolUiRequestInput = Record<string, unknown>;

type ToolUiRequestOptions<TResponse> = {
  toolCallId: string;
  toolName: string;
  input: ToolUiRequestInput;
  signal?: AbortSignal | undefined;
  parseResponse: (raw: unknown) => TResponse;
};

type PendingToolUiRequest<TResponse> = {
  id: string;
  frame: ToolUiRequestFrame;
  resolve: (response: TResponse) => void;
  parseResponse: (raw: unknown) => TResponse;
};

type ToolUiRequestFrame = {
  type: "tool_ui_request";
  id: string;
  toolCallId: string;
  toolName: string;
  input: ToolUiRequestInput;
};

type ToolUiDeliverResult =
  | { status: "delivered" }
  | { status: "none-pending" }
  | { status: "invalid"; reason: string };

class ToolUiBroker {
  private socket: WebSocketInstance | undefined;
  private pending: PendingToolUiRequest<unknown> | undefined;

  attach(socket: WebSocketInstance): () => void {
    this.socket = socket;
    this.sendPendingRequest(socket);
    return () => {
      if (this.socket === socket) {
        this.socket = undefined;
      }
    };
  }

  request<TResponse>(options: ToolUiRequestOptions<TResponse>): Promise<TResponse> {
    const { signal } = options;
    if (signal !== undefined && signal.aborted) {
      return Promise.reject(
        new Error(`${options.toolName} UI request was aborted before it started.`),
      );
    }
    if (this.pending !== undefined) {
      return Promise.reject(
        new Error("A tool UI request is already pending for this Agent Thread."),
      );
    }

    const id = uuidv7();
    const frame: ToolUiRequestFrame = {
      type: "tool_ui_request",
      id,
      toolCallId: options.toolCallId,
      toolName: options.toolName,
      input: options.input,
    };

    return new Promise<TResponse>((resolve, reject) => {
      const cleanup = () => {
        if (this.pending !== undefined && this.pending.id === id) {
          this.pending = undefined;
        }
        if (signal !== undefined) {
          signal.removeEventListener("abort", onAbort);
        }
      };
      const onAbort = () => {
        cleanup();
        reject(new Error(`${options.toolName} UI request was aborted.`));
      };

      if (signal !== undefined) {
        signal.addEventListener("abort", onAbort);
      }

      this.pending = {
        id,
        frame,
        resolve: (response) => {
          cleanup();
          resolve(response as TResponse);
        },
        parseResponse: options.parseResponse as (raw: unknown) => unknown,
      };

      const socket = this.socket;
      if (socket === undefined) {
        return;
      }
      send(socket, frame);
    });
  }

  deliverResponse(id: string, raw: unknown): ToolUiDeliverResult {
    const pending = this.pending;
    if (pending === undefined || pending.id !== id) {
      return { status: "none-pending" };
    }

    let parsed: unknown;
    try {
      parsed = pending.parseResponse(raw);
    } catch (error) {
      return {
        status: "invalid",
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    pending.resolve(parsed);
    return { status: "delivered" };
  }

  private sendPendingRequest(socket: WebSocketInstance): void {
    const pending = this.pending;
    if (pending === undefined) {
      return;
    }
    send(socket, pending.frame);
  }
}

function send(socket: WebSocketInstance, frame: ToolUiRequestFrame): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  try {
    socket.send(JSON.stringify(frame));
  } catch {
    // The socket close path detaches stale connections; a failed frame can be
    // replayed when the frontend reconnects.
  }
}

export { ToolUiBroker };
export type { ToolUiDeliverResult, ToolUiRequestInput, ToolUiRequestOptions };
