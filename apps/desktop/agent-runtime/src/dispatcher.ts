import type { ImageContent } from "@earendil-works/pi-ai";

import { createPiRuntime, type PiRuntime, type RuntimeEventEmitter } from "./pi-runtime";
import {
  PACKAGE_NAME,
  PROTOCOL_VERSION,
  type AppCommand,
  type InitializedThreadState,
  type RuntimeCommand,
  type RuntimeErrorResponse,
  type RuntimeResponse,
  type RuntimeState,
} from "./protocol";

export type RuntimeContext = {
  thread?: InitializedThreadState;
  pi?: PiRuntime;
  emit: RuntimeEventEmitter;
};

type PromptCommand = {
  readonly id: string;
  readonly type: "prompt";
  readonly message: string;
  readonly images?: ImageContent[];
  readonly streamingBehavior?: "steer" | "followUp";
};

export async function dispatchRuntimeCommand(
  context: RuntimeContext,
  command: RuntimeCommand,
): Promise<RuntimeResponse> {
  switch (command.type) {
    case "app:initialize_thread":
    case "app:get_runtime_state":
    case "app:shutdown":
      return await dispatchAppCommand(context, command);
    case "prompt":
      return await dispatchPromptCommand(context, toPromptCommand(command));
    case "steer":
    case "follow_up":
    case "abort":
    case "new_session":
    case "get_state":
    case "set_model":
    case "cycle_model":
    case "get_available_models":
    case "set_thinking_level":
    case "cycle_thinking_level":
    case "set_steering_mode":
    case "set_follow_up_mode":
    case "compact":
    case "set_auto_compaction":
    case "set_auto_retry":
    case "abort_retry":
    case "bash":
    case "abort_bash":
    case "get_session_stats":
    case "export_html":
    case "switch_session":
    case "fork":
    case "clone":
    case "get_fork_messages":
    case "get_last_assistant_text":
    case "set_session_name":
    case "get_messages":
    case "get_commands":
      return piCommandNotImplemented(command.id, command.type, context.pi !== undefined);
    case "extension_ui_response":
      return piCommandNotImplemented(command.id, command.type, context.pi !== undefined);
  }
}

async function dispatchAppCommand(
  context: RuntimeContext,
  command: AppCommand,
): Promise<RuntimeResponse> {
  switch (command.type) {
    case "app:initialize_thread": {
      if (context.thread !== undefined) {
        return createRuntimeErrorResponse(
          command.id,
          command.type,
          "thread_already_initialized",
          "This agent runtime process already has an initialized Agent Thread.",
          {
            existingThreadId: context.thread.threadId,
            requestedThreadId: command.threadId,
          },
        );
      }

      try {
        const pi = await createPiRuntime({
          threadId: command.threadId,
          projectPath: command.projectPath,
          ...(command.displayName ? { displayName: command.displayName } : {}),
          ...(command.restoredMessages !== undefined
            ? { restoredMessages: command.restoredMessages }
            : {}),
          emit: context.emit,
        });
        context.thread = pi.thread;
        context.pi = pi;

        context.emit({
          type: "app:thread_initialized",
          threadId: pi.thread.threadId,
          sessionId: pi.thread.sessionId,
        });
        context.emit({
          type: "app:runtime_state_changed",
          state: getRuntimeState(context),
        });

        return {
          id: command.id,
          type: "response",
          command: command.type,
          success: true,
          data: {
            threadId: pi.thread.threadId,
            sessionId: pi.thread.sessionId,
          },
        };
      } catch (error) {
        return createRuntimeErrorResponse(
          command.id,
          command.type,
          "pi_runtime_error",
          "Failed to initialize Pi runtime for Agent Thread.",
          {
            threadId: command.threadId,
            projectPath: command.projectPath,
            cause: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
    case "app:get_runtime_state":
      return {
        id: command.id,
        type: "response",
        command: command.type,
        success: true,
        data: getRuntimeState(context),
      };
    case "app:shutdown":
      if (context.pi !== undefined) {
        try {
          await context.pi.dispose();
        } catch (error) {
          return createRuntimeErrorResponse(
            command.id,
            command.type,
            "shutdown_error",
            "Failed to dispose Pi runtime during shutdown.",
            { cause: error instanceof Error ? error.message : String(error) },
          );
        }
        delete context.pi;
        delete context.thread;
      }

      return {
        id: command.id,
        type: "response",
        command: command.type,
        success: true,
      };
  }
}

function toPromptCommand(command: RuntimeCommand): PromptCommand {
  if (command.type !== "prompt" || typeof command.message !== "string") {
    throw new Error("Validated prompt command is missing message.");
  }

  return {
    id: command.id,
    type: "prompt",
    message: command.message,
    ...(Array.isArray(command.images) ? { images: command.images as ImageContent[] } : {}),
    ...(command.streamingBehavior === "steer" || command.streamingBehavior === "followUp"
      ? { streamingBehavior: command.streamingBehavior }
      : {}),
  };
}

async function dispatchPromptCommand(
  context: RuntimeContext,
  command: PromptCommand,
): Promise<RuntimeResponse> {
  if (context.pi === undefined) {
    return piCommandNotImplemented(command.id, command.type, false);
  }

  try {
    const options = {
      ...(Array.isArray(command.images) ? { images: command.images as ImageContent[] } : {}),
      ...(command.streamingBehavior === "steer" || command.streamingBehavior === "followUp"
        ? { streamingBehavior: command.streamingBehavior }
        : {}),
      source: "rpc" as const,
    };
    await context.pi.runtime.session.prompt(command.message, options);

    return {
      id: command.id,
      type: "response",
      command: command.type,
      success: true,
    };
  } catch (error) {
    return createRuntimeErrorResponse(
      command.id,
      command.type,
      "pi_runtime_error",
      "Pi failed to process prompt command.",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

export function getRuntimeState(context: RuntimeContext): RuntimeState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    packageName: PACKAGE_NAME,
    ...(context.thread !== undefined ? { thread: context.thread } : {}),
    ...(context.pi !== undefined ? { pi: context.pi.getState() } : {}),
  };
}

export function createRuntimeErrorResponse(
  id: string,
  command: string,
  code: RuntimeErrorResponse["error"]["code"],
  message: string,
  details?: unknown,
): RuntimeErrorResponse {
  return {
    id,
    type: "response",
    command,
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

function piCommandNotImplemented(
  id: string,
  command: string,
  initialized: boolean,
): RuntimeErrorResponse {
  if (!initialized) {
    return createRuntimeErrorResponse(
      id,
      command,
      "thread_not_initialized",
      "Initialize an Agent Thread with app:initialize_thread before sending Pi commands.",
    );
  }

  return createRuntimeErrorResponse(
    id,
    command,
    "pi_runtime_error",
    "Pi runtime is initialized, but this Pi command has not been implemented by @kira/agent-runtime yet.",
  );
}
