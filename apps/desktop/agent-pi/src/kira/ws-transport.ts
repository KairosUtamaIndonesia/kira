import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { WebSocket } from "ws";

import type { ToolUiBroker } from "./tool-ui-broker";

/**
 * RPC response frame acknowledging a command. Mirrors pi's RPC protocol shape so
 * the desktop client speaks one familiar contract over the WebSocket.
 */
type RpcResponse = {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  error?: string;
  data?: unknown;
};

type ParsedCommand = {
  id?: string;
  type: string;
  message?: string;
  images?: ImageContent[];
  streamingBehavior?: "steer" | "followUp";
  targetId?: string;
  response?: unknown;
  options?: {
    summarize?: boolean;
    customInstructions?: string;
    replaceInstructions?: boolean;
    label?: string;
  };
};

function send(ws: WebSocket, payload: unknown): void {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // A frame that cannot be serialized or a closed socket is dropped; the next
    // event or the close handler reconciles client state.
  }
}

function respond(
  ws: WebSocket,
  id: string | undefined,
  command: string,
  success: boolean,
  extra?: { error?: string; data?: unknown },
): void {
  const frame: RpcResponse = { type: "response", command, success };
  if (id !== undefined) {
    frame.id = id;
  }
  if (extra !== undefined && extra.error !== undefined) {
    frame.error = extra.error;
  }
  if (extra !== undefined && extra.data !== undefined) {
    frame.data = extra.data;
  }
  send(ws, frame);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function promptOptions(
  images: ImageContent[] | undefined,
  streamingBehavior?: "steer" | "followUp",
): { images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" } | undefined {
  if (images === undefined && streamingBehavior === undefined) {
    return undefined;
  }
  const options: { images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" } = {};
  if (images !== undefined) {
    options.images = images;
  }
  if (streamingBehavior !== undefined) {
    options.streamingBehavior = streamingBehavior;
  }
  return options;
}

function requireMessage(command: ParsedCommand): string {
  if (typeof command.message !== "string" || command.message.length === 0) {
    throw new Error(`${command.type} requires a non-empty 'message'.`);
  }
  return command.message;
}

/**
 * Bridge one desktop WebSocket connection to an Agent Thread's Pi AgentSession.
 *
 * Outbound: every Pi session event is forwarded verbatim as a JSON frame.
 * Inbound: RPC commands (`prompt`/`steer`/`follow_up`/`abort`/`navigate_tree`)
 * drive the session. `prompt` is fire-and-forget — it is acknowledged on accept
 * and its progress streams back through the event subscription.
 */
export function attachAgentSocket(
  ws: WebSocket,
  session: AgentSession,
  toolUiBroker: ToolUiBroker,
): void {
  const detachToolUi = toolUiBroker.attach(ws);
  const unsubscribe = session.subscribe((event) => {
    send(ws, event);
  });

  ws.on("message", (data) => {
    void handleCommand(ws, session, toolUiBroker, data.toString());
  });

  ws.on("close", () => {
    detachToolUi();
    unsubscribe();
  });
}

async function handleCommand(
  ws: WebSocket,
  session: AgentSession,
  toolUiBroker: ToolUiBroker,
  raw: string,
): Promise<void> {
  let command: ParsedCommand;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as ParsedCommand).type !== "string"
    ) {
      respond(ws, undefined, "unknown", false, {
        error: "Command must be an object with a 'type'.",
      });
      return;
    }
    command = parsed as ParsedCommand;
  } catch {
    respond(ws, undefined, "unknown", false, { error: "Command must be valid JSON." });
    return;
  }

  try {
    switch (command.type) {
      case "prompt": {
        const message = requireMessage(command);
        if (command.streamingBehavior === "steer" || command.streamingBehavior === "followUp") {
          await session.prompt(message, promptOptions(command.images, command.streamingBehavior));
        } else {
          void (async () => {
            try {
              await session.prompt(message, promptOptions(command.images));
            } catch (error) {
              send(ws, { type: "error", scope: "prompt", message: errorMessage(error) });
            }
          })();
        }
        respond(ws, command.id, "prompt", true);
        return;
      }
      case "steer": {
        await session.steer(requireMessage(command));
        respond(ws, command.id, "steer", true);
        return;
      }
      case "follow_up": {
        await session.followUp(requireMessage(command));
        respond(ws, command.id, "follow_up", true);
        return;
      }
      case "tool_ui_response": {
        if (typeof command.id !== "string" || command.id.length === 0) {
          throw new Error("tool_ui_response requires a non-empty 'id'.");
        }
        const result = toolUiBroker.deliverResponse(command.id, command.response);
        switch (result.status) {
          case "delivered":
            respond(ws, command.id, "tool_ui_response", true);
            return;
          case "none-pending":
            respond(ws, command.id, "tool_ui_response", false, {
              error: "No matching tool UI request is pending for this Agent Thread.",
            });
            return;
          case "invalid":
            respond(ws, command.id, "tool_ui_response", false, { error: result.reason });
            return;
          default:
            return exhaustiveToolUiResult(result);
        }
      }
      case "abort": {
        await session.abort();
        respond(ws, command.id, "abort", true);
        return;
      }
      case "navigate_tree": {
        if (typeof command.targetId !== "string" || command.targetId.length === 0) {
          throw new Error("navigate_tree requires a non-empty 'targetId'.");
        }
        const result = await session.navigateTree(command.targetId, command.options);
        respond(ws, command.id, "navigate_tree", true, { data: result });
        return;
      }
      default: {
        respond(ws, command.id, command.type, false, { error: `Unknown command: ${command.type}` });
        return;
      }
    }
  } catch (error) {
    respond(ws, command.id, command.type, false, { error: errorMessage(error) });
  }
}

function exhaustiveToolUiResult(result: never): never {
  throw new Error(`Unhandled tool UI delivery result: ${JSON.stringify(result)}`);
}
