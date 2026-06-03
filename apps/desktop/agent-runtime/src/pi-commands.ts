import type { ImageContent } from "@earendil-works/pi-ai";
import type { SourceInfo } from "@earendil-works/pi-coding-agent";

import type { PiRuntime } from "./pi-runtime";
import type { RuntimeCommand, RuntimeErrorResponse, RuntimeResponse } from "./protocol";

export async function dispatchPiCommand(
  pi: PiRuntime | undefined,
  command: RuntimeCommand,
): Promise<RuntimeResponse> {
  if (pi === undefined) {
    return createRuntimeErrorResponse(
      command.id,
      command.type,
      "thread_not_initialized",
      "Initialize an Agent Thread with app:initialize_thread before sending Pi commands.",
    );
  }

  switch (command.type) {
    case "prompt":
      return await dispatchPromptCommand(pi, toMessageCommand(command, "prompt"));
    case "steer":
      return await dispatchSteerCommand(pi, toMessageCommand(command, "steer"));
    case "follow_up":
      return await dispatchFollowUpCommand(pi, toMessageCommand(command, "follow_up"));
    case "abort":
      return await dispatchAbortCommand(pi, command.id);
    case "get_state":
      return {
        id: command.id,
        type: "response",
        command: command.type,
        success: true,
        data: pi.getState(),
      };
    case "get_messages":
      return {
        id: command.id,
        type: "response",
        command: command.type,
        success: true,
        data: {
          messages: pi.runtime.session.messages,
        },
      };
    case "get_commands":
      return {
        id: command.id,
        type: "response",
        command: command.type,
        success: true,
        data: {
          commands: getSlashCommands(pi),
        },
      };
    case "new_session":
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
      return createRuntimeErrorResponse(
        command.id,
        command.type,
        "pi_runtime_error",
        "Pi runtime is initialized, but this Pi command has not been implemented by @kira/agent-runtime yet.",
      );
    case "app:initialize_thread":
    case "app:get_runtime_state":
    case "app:shutdown":
    case "extension_ui_response":
      return createRuntimeErrorResponse(
        command.id,
        command.type,
        "invalid_command",
        `Command ${command.type} is not a Pi session command.`,
      );
  }
}

async function dispatchPromptCommand(
  pi: PiRuntime,
  command: MessageCommand<"prompt">,
): Promise<RuntimeResponse> {
  try {
    await pi.runtime.session.prompt(command.message, {
      ...(command.images !== undefined ? { images: command.images } : {}),
      ...(command.streamingBehavior !== undefined
        ? { streamingBehavior: command.streamingBehavior }
        : {}),
      source: "rpc",
    });

    return {
      id: command.id,
      type: "response",
      command: command.type,
      success: true,
    };
  } catch (error) {
    return piRuntimeError(command.id, command.type, "Pi failed to process prompt command.", error);
  }
}

async function dispatchSteerCommand(
  pi: PiRuntime,
  command: MessageCommand<"steer">,
): Promise<RuntimeResponse> {
  try {
    await pi.runtime.session.steer(command.message, command.images);
    return {
      id: command.id,
      type: "response",
      command: command.type,
      success: true,
    };
  } catch (error) {
    return piRuntimeError(command.id, command.type, "Pi failed to process steer command.", error);
  }
}

async function dispatchFollowUpCommand(
  pi: PiRuntime,
  command: MessageCommand<"follow_up">,
): Promise<RuntimeResponse> {
  try {
    await pi.runtime.session.followUp(command.message, command.images);
    return {
      id: command.id,
      type: "response",
      command: command.type,
      success: true,
    };
  } catch (error) {
    return piRuntimeError(
      command.id,
      command.type,
      "Pi failed to process follow_up command.",
      error,
    );
  }
}

async function dispatchAbortCommand(pi: PiRuntime, id: string): Promise<RuntimeResponse> {
  try {
    await pi.runtime.session.abort();
    return {
      id,
      type: "response",
      command: "abort",
      success: true,
    };
  } catch (error) {
    return piRuntimeError(id, "abort", "Pi failed to process abort command.", error);
  }
}

function getSlashCommands(pi: PiRuntime): SlashCommand[] {
  const prompts = pi.runtime.session.promptTemplates.map((prompt): SlashCommand => {
    return {
      name: prompt.name,
      description: prompt.description,
      source: "prompt",
      sourceInfo: prompt.sourceInfo,
    };
  });

  const skills = pi.runtime.session.resourceLoader.getSkills().skills.map((skill): SlashCommand => {
    return {
      name: `skill:${skill.name}`,
      description: skill.description,
      source: "skill",
      sourceInfo: skill.sourceInfo,
    };
  });

  return [...prompts, ...skills];
}

function toMessageCommand<TType extends "prompt" | "steer" | "follow_up">(
  command: RuntimeCommand,
  type: TType,
): MessageCommand<TType> {
  if (command.type !== type || typeof command.message !== "string") {
    throw new Error(`Validated ${type} command is missing message.`);
  }

  return {
    id: command.id,
    type,
    message: command.message,
    ...(Array.isArray(command.images) ? { images: command.images as ImageContent[] } : {}),
    ...(type === "prompt" && isStreamingBehavior(command.streamingBehavior)
      ? { streamingBehavior: command.streamingBehavior }
      : {}),
  };
}

function isStreamingBehavior(value: unknown): value is "steer" | "followUp" {
  return value === "steer" || value === "followUp";
}

function piRuntimeError(
  id: string,
  command: string,
  message: string,
  error: unknown,
): RuntimeErrorResponse {
  return createRuntimeErrorResponse(id, command, "pi_runtime_error", message, {
    cause: error instanceof Error ? error.message : String(error),
  });
}

function createRuntimeErrorResponse(
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

type SlashCommand = {
  readonly name: string;
  readonly description?: string;
  readonly source: "extension" | "prompt" | "skill";
  readonly sourceInfo: SourceInfo;
};

type MessageCommand<TType extends "prompt" | "steer" | "follow_up"> = {
  readonly id: string;
  readonly type: TType;
  readonly message: string;
  readonly images?: ImageContent[];
  readonly streamingBehavior?: "steer" | "followUp";
};
