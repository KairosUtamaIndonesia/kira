import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { WebSocket } from "ws";

import { readFileSync } from "node:fs";

import type { ToolUiBroker } from "./tool-ui-broker";

import { getModelCatalog, type ModelConfig } from "./model-catalog";
import { piModelFromConfig } from "./pi-model";
import { stripSkillFrontmatter } from "./skill-expansion";

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
  modelLabel?: string;
  images?: ImageContent[];
  streamingBehavior?: "steer" | "followUp";
  targetId?: string;
  response?: unknown;
  customInstructions?: string;
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
 * Replace every `/skill:<name> <args>` invocation in `text` with a Pi-compatible
 * `<skill>` block plus trailing args, mirroring `_expandSkillCommand` in
 * pi-coding-agent. Unknown skills are left untouched so the agent runtime sees
 * a clean prompt either way.
 */
function expandSkillCommandsInText(text: string, session: AgentSession): string {
  const pattern = /(^|\s)(\/skill:([A-Za-z0-9_:-]+))((?:\s[^\n]*)?)/g;
  return text.replace(pattern, (match, lead: string, _full: string, name: string, args: string) => {
    const trimmedArgs = args.replace(/^\s+/, "").replace(/\s+$/, "");
    const skill = session.resourceLoader
      .getSkills()
      .skills.find((candidate) => candidate.name === name);
    if (skill === undefined) {
      return match;
    }
    let body: string;
    try {
      const content = readFileSync(skill.filePath, "utf-8");
      body = stripSkillFrontmatter(content).trim();
    } catch {
      return match;
    }
    const block = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
    return trimmedArgs.length === 0 ? `${lead}${block}` : `${lead}${block}\n\n${trimmedArgs}`;
  });
}

/**
 * Extract a human-readable error message from an agent_end event if the last
 * assistant message has stopReason: "error".
 */
function agentEndErrorMessage(event: Record<string, unknown>): string | undefined {
  const messages = event.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return undefined;
  }
  const lastMsg = messages[messages.length - 1];
  if (
    typeof lastMsg === "object" &&
    lastMsg !== null &&
    (lastMsg as Record<string, unknown>).stopReason === "error" &&
    typeof (lastMsg as Record<string, unknown>).errorMessage === "string"
  ) {
    return (lastMsg as Record<string, unknown>).errorMessage as string;
  }
  return undefined;
}

/**
 * Map a raw provider/pi error message to something actionable for the user.
 */
function userFacingError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("auth") ||
    lower.includes("api key")
  ) {
    return "The model API key is invalid or was rejected. Update it in Organization > Models in the cloud console.";
  }
  return raw;
}

/**
 * Tracks the error message from the last agent_end event whose final assistant
 * message had stopReason: "error". Cleared before each prompt call so we can
 * detect whether the current prompt completed with an error even though pi
 * resolves internally rather than throwing.
 */
class AgentEndErrorTracker {
  private value: string | undefined;

  get(): string | undefined {
    return this.value;
  }

  clear(): void {
    this.value = undefined;
  }

  set(newValue: string | undefined): void {
    this.value = newValue;
  }
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
  const errorTracker = new AgentEndErrorTracker();

  const detachToolUi = toolUiBroker.attach(ws);
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "agent_end") {
      errorTracker.set(agentEndErrorMessage(event as Record<string, unknown>));
    }
    send(ws, event);
  });

  ws.on("message", (data) => {
    void handleCommand(ws, session, toolUiBroker, data.toString(), errorTracker);
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
  errorTracker: AgentEndErrorTracker,
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
        const message = expandSkillCommandsInText(requireMessage(command), session);
        if (command.streamingBehavior === "steer" || command.streamingBehavior === "followUp") {
          errorTracker.clear();
          await session.prompt(message, promptOptions(command.images, command.streamingBehavior));
          const completionError = errorTracker.get();
          if (completionError !== undefined) {
            respond(ws, command.id, "prompt", false, {
              error: userFacingError(completionError),
            });
          } else {
            respond(ws, command.id, "prompt", true);
          }
        } else {
          void (async () => {
            try {
              errorTracker.clear();
              await session.prompt(message, promptOptions(command.images));
              const completionError = errorTracker.get();
              if (completionError !== undefined) {
                send(ws, {
                  type: "error",
                  error: userFacingError(completionError),
                  message: userFacingError(completionError),
                });
              }
            } catch (error) {
              send(ws, { type: "error", error: errorMessage(error), message: errorMessage(error) });
            }
          })();
          respond(ws, command.id, "prompt", true);
        }
        return;
      }
      case "steer": {
        const message = expandSkillCommandsInText(requireMessage(command), session);
        await session.steer(message);
        respond(ws, command.id, "steer", true);
        return;
      }
      case "follow_up": {
        const message = expandSkillCommandsInText(requireMessage(command), session);
        await session.followUp(message);
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
              error: "No pending tool UI request with that id.",
            });
            return;
        }
        return;
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
        const options = command.options;
        const customInstructions =
          options !== undefined && "customInstructions" in options
            ? options.customInstructions
            : undefined;
        const replaceInstructions =
          options !== undefined && "replaceInstructions" in options
            ? options.replaceInstructions
            : undefined;
        const label = options !== undefined && "label" in options ? options.label : undefined;
        const summarize =
          options !== undefined && "summarize" in options ? options.summarize : undefined;
        await session.navigateTree(command.targetId, {
          ...(customInstructions === undefined ? {} : { customInstructions }),
          ...(replaceInstructions === undefined ? {} : { replaceInstructions }),
          ...(label === undefined ? {} : { label }),
          ...(summarize === undefined ? {} : { summarize }),
        });
        respond(ws, command.id, "navigate_tree", true);
        return;
      }
      case "switch_model": {
        if (typeof command.modelLabel !== "string" || command.modelLabel.length === 0) {
          throw new Error("switch_model requires a non-empty 'modelLabel'.");
        }
        const catalog = await getModelCatalog();
        const modelConfig: ModelConfig | undefined = catalog.models.find(
          (m: ModelConfig) => m.label === command.modelLabel,
        );
        if (modelConfig === undefined) {
          throw new Error(`Unknown model: ${command.modelLabel}`);
        }
        const model: Model<"openai-completions"> = piModelFromConfig(modelConfig);
        // Ensure the new model's API key is in the auth storage before switching
        if (modelConfig.apiKey !== undefined) {
          session.modelRegistry.authStorage.setRuntimeApiKey(model.provider, modelConfig.apiKey);
        }
        await session.setModel(model);
        session.setThinkingLevel(modelConfig.thinkingLevel);
        respond(ws, command.id, "switch_model", true);
        return;
      }
      case "compact": {
        const customInstructions =
          typeof command.customInstructions === "string" && command.customInstructions.length > 0
            ? command.customInstructions
            : undefined;
        // Pi emits `compaction_start` / `compaction_end` itself; the desktop
        // client listens for those events to reflect the in-flight state.
        // Wait for the compactor to finish before acknowledging so the caller's
        // `await` resolves only when the new context is durable.
        try {
          const result = await session.compact(customInstructions);
          respond(ws, command.id, "compact", true, { data: { result } });
        } catch (error) {
          const message = errorMessage(error);
          if (message === "Compaction failed: Already compacted") {
            respond(ws, command.id, "compact", true, { data: { alreadyCompacted: true } });
          } else {
            respond(ws, command.id, "compact", false, { error: message });
          }
        }
        return;
      }
      default:
        respond(ws, command.id, command.type, false, {
          error: `Unknown command type: ${command.type}`,
        });
    }
  } catch (error) {
    respond(ws, command.id, command.type, false, { error: errorMessage(error) });
  }
}
