import type { AgentHarness } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { WebSocket } from "ws";

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
): { images?: ImageContent[] } | undefined {
  return images === undefined ? undefined : { images };
}

function requireMessage(command: ParsedCommand): string {
  if (typeof command.message !== "string" || command.message.length === 0) {
    throw new Error(`${command.type} requires a non-empty 'message'.`);
  }
  return command.message;
}

/**
 * Bridge one desktop WebSocket connection to an Agent Thread's harness.
 *
 * Outbound: every `AgentHarnessEvent` is forwarded verbatim as a JSON frame.
 * Inbound: RPC commands (`prompt`/`steer`/`follow_up`/`abort`/`navigate_tree`)
 * drive the harness. `prompt` is fire-and-forget — it is acknowledged on accept
 * and its progress streams back through the event subscription.
 */
export function attachAgentSocket(ws: WebSocket, harness: AgentHarness): void {
  const unsubscribe = harness.subscribe((event) => {
    send(ws, event);
  });

  ws.on("message", (data) => {
    void handleCommand(ws, harness, data.toString());
  });

  ws.on("close", () => {
    unsubscribe();
  });
}

async function handleCommand(ws: WebSocket, harness: AgentHarness, raw: string): Promise<void> {
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
        if (command.streamingBehavior === "steer") {
          await harness.steer(message, promptOptions(command.images));
        } else if (command.streamingBehavior === "followUp") {
          await harness.followUp(message, promptOptions(command.images));
        } else {
          void (async () => {
            try {
              await harness.prompt(message, promptOptions(command.images));
            } catch (error) {
              send(ws, { type: "error", scope: "prompt", message: errorMessage(error) });
            }
          })();
        }
        respond(ws, command.id, "prompt", true);
        return;
      }
      case "steer": {
        await harness.steer(requireMessage(command), promptOptions(command.images));
        respond(ws, command.id, "steer", true);
        return;
      }
      case "follow_up": {
        await harness.followUp(requireMessage(command), promptOptions(command.images));
        respond(ws, command.id, "follow_up", true);
        return;
      }
      case "abort": {
        await harness.abort();
        respond(ws, command.id, "abort", true);
        return;
      }
      case "navigate_tree": {
        if (typeof command.targetId !== "string" || command.targetId.length === 0) {
          throw new Error("navigate_tree requires a non-empty 'targetId'.");
        }
        const result = await harness.navigateTree(command.targetId, command.options);
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
