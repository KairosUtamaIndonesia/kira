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
};

export async function dispatchRuntimeCommand(
  context: RuntimeContext,
  command: RuntimeCommand,
): Promise<RuntimeResponse> {
  switch (command.type) {
    case "app:initialize_thread":
    case "app:get_runtime_state":
    case "app:shutdown":
      return dispatchAppCommand(context, command);
    case "prompt":
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
      return piRuntimeNotConnected(command.id, command.type);
    case "extension_ui_response":
      return piRuntimeNotConnected(command.id, command.type);
  }
}

function dispatchAppCommand(context: RuntimeContext, command: AppCommand): RuntimeResponse {
  switch (command.type) {
    case "app:initialize_thread": {
      if (context.thread !== undefined) {
        return {
          id: command.id,
          type: "response",
          command: command.type,
          success: false,
          error: {
            code: "thread_already_initialized",
            message: "This agent runtime process already has an initialized Agent Thread.",
            details: {
              existingThreadId: context.thread.threadId,
              requestedThreadId: command.threadId,
            },
          },
        };
      }

      const thread = {
        threadId: command.threadId,
        projectPath: command.projectPath,
        ...(command.displayName ? { displayName: command.displayName } : {}),
        sessionId: command.threadId,
      };
      context.thread = thread;

      return {
        id: command.id,
        type: "response",
        command: command.type,
        success: true,
        data: {
          threadId: thread.threadId,
          sessionId: thread.sessionId,
        },
      };
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
      return {
        id: command.id,
        type: "response",
        command: command.type,
        success: true,
      };
  }
}

export function getRuntimeState(context: RuntimeContext): RuntimeState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    packageName: PACKAGE_NAME,
    ...(context.thread !== undefined ? { thread: context.thread } : {}),
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

function piRuntimeNotConnected(id: string, command: string): RuntimeErrorResponse {
  return createRuntimeErrorResponse(
    id,
    command,
    "pi_runtime_error",
    "Pi runtime dispatch is not connected yet. Runtime protocol dispatch is available, but Pi SDK command handling will be added in the runtime integration step.",
  );
}
