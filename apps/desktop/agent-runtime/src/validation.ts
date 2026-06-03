import type { RuntimeCommand, RuntimeError } from "./protocol";

type RuntimeCommandType = RuntimeCommand["type"];
type AppCommandType = "app:initialize_thread" | "app:get_runtime_state" | "app:shutdown";
type PiCommandType = Exclude<RuntimeCommandType, AppCommandType | "extension_ui_response">;

export type CommandValidationResult =
  | {
      readonly ok: true;
      readonly command: RuntimeCommand;
    }
  | {
      readonly ok: false;
      readonly commandId: string;
      readonly commandType: string;
      readonly error: RuntimeError;
    };

const INVALID_COMMAND_ID = "invalid";
const INVALID_COMMAND_TYPE = "invalid";
const PROMPT_STREAMING_BEHAVIORS = new Set(["steer", "followUp"]);
const QUEUE_MODES = new Set(["all", "one-at-a-time"]);
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
const EXTENSION_UI_RESPONSE_KEYS = new Set(["value", "confirmed", "cancelled"]);

export function validateRuntimeCommand(value: unknown): CommandValidationResult {
  if (!isRecord(value)) {
    return invalidCommand(
      INVALID_COMMAND_ID,
      INVALID_COMMAND_TYPE,
      "Command must be a JSON object.",
    );
  }

  const id = readString(value, "id");
  const type = readString(value, "type");

  if (!id) {
    return invalidCommand(
      INVALID_COMMAND_ID,
      type ?? INVALID_COMMAND_TYPE,
      "Command id must be a non-empty string.",
    );
  }

  if (!type) {
    return invalidCommand(id, INVALID_COMMAND_TYPE, "Command type must be a non-empty string.");
  }

  switch (type) {
    case "app:initialize_thread":
      return validateInitializeThreadCommand(id, value);
    case "app:get_runtime_state":
    case "app:shutdown":
    case "abort":
    case "new_session":
    case "get_state":
    case "cycle_model":
    case "get_available_models":
    case "cycle_thinking_level":
    case "abort_retry":
    case "abort_bash":
    case "get_session_stats":
    case "export_html":
    case "clone":
    case "get_fork_messages":
    case "get_last_assistant_text":
    case "get_messages":
    case "get_commands":
      return { ok: true, command: { id, type } };
    case "prompt":
      return validateMessageCommand(id, type, value, true);
    case "steer":
    case "follow_up":
      return validateMessageCommand(id, type, value, false);
    case "set_model":
      return validateRequiredStrings(id, type, value, ["provider", "modelId"]);
    case "set_thinking_level":
      return validateEnumString(id, type, value, "level", THINKING_LEVELS);
    case "set_steering_mode":
    case "set_follow_up_mode":
      return validateEnumString(id, type, value, "mode", QUEUE_MODES);
    case "compact":
      return validateOptionalString(id, type, value, "customInstructions");
    case "set_auto_compaction":
    case "set_auto_retry":
      return validateRequiredBoolean(id, type, value, "enabled");
    case "bash":
      return validateRequiredStrings(id, type, value, ["command"]);
    case "switch_session":
      return validateRequiredStrings(id, type, value, ["sessionPath"]);
    case "fork":
      return validateRequiredStrings(id, type, value, ["entryId"]);
    case "set_session_name":
      return validateRequiredStrings(id, type, value, ["name"]);
    case "extension_ui_response":
      return validateExtensionUiResponse(id, value);
  }

  return invalidCommand(id, type, `Unsupported command type: ${type}.`);
}

function validateInitializeThreadCommand(
  id: string,
  value: Readonly<Record<string, unknown>>,
): CommandValidationResult {
  const threadId = readString(value, "threadId");
  if (!threadId) {
    return invalidCommand(id, "app:initialize_thread", "threadId must be a non-empty string.");
  }

  const projectPath = readString(value, "projectPath");
  if (!projectPath) {
    return invalidCommand(id, "app:initialize_thread", "projectPath must be a non-empty string.");
  }

  const displayName = readOptionalString(value, "displayName");
  if (displayName === false) {
    return invalidCommand(
      id,
      "app:initialize_thread",
      "displayName must be a string when provided.",
    );
  }

  const restoredMessages = value.restoredMessages;
  if (restoredMessages !== undefined && !Array.isArray(restoredMessages)) {
    return invalidCommand(
      id,
      "app:initialize_thread",
      "restoredMessages must be an array when provided.",
    );
  }

  return {
    ok: true,
    command: {
      id,
      type: "app:initialize_thread",
      threadId,
      projectPath,
      ...(displayName ? { displayName } : {}),
      ...(Array.isArray(restoredMessages) ? { restoredMessages } : {}),
    },
  };
}

function validateMessageCommand(
  id: string,
  type: "prompt" | "steer" | "follow_up",
  value: Readonly<Record<string, unknown>>,
  allowStreamingBehavior: boolean,
): CommandValidationResult {
  const message = readString(value, "message");
  if (!message) {
    return invalidCommand(id, type, "message must be a non-empty string.");
  }

  const images = value.images;
  if (images !== undefined && !Array.isArray(images)) {
    return invalidCommand(id, type, "images must be an array when provided.");
  }

  if (!allowStreamingBehavior) {
    return {
      ok: true,
      command: {
        id,
        type,
        message,
        ...(Array.isArray(images) ? { images } : {}),
      },
    };
  }

  const streamingBehavior = readOptionalEnumString(
    value,
    "streamingBehavior",
    PROMPT_STREAMING_BEHAVIORS,
  );
  if (streamingBehavior === false) {
    return invalidCommand(id, type, "streamingBehavior must be steer or followUp when provided.");
  }

  return {
    ok: true,
    command: {
      id,
      type,
      message,
      ...(Array.isArray(images) ? { images } : {}),
      ...(streamingBehavior ? { streamingBehavior } : {}),
    },
  };
}

function validateRequiredStrings(
  id: string,
  type: PiCommandType,
  value: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): CommandValidationResult {
  const data: Record<string, string> = {};
  for (const field of fields) {
    const fieldValue = readString(value, field);
    if (!fieldValue) {
      return invalidCommand(id, type, `${field} must be a non-empty string.`);
    }
    data[field] = fieldValue;
  }

  return { ok: true, command: { id, type, ...data } };
}

function validateRequiredBoolean(
  id: string,
  type: PiCommandType,
  value: Readonly<Record<string, unknown>>,
  field: string,
): CommandValidationResult {
  const fieldValue = value[field];
  if (typeof fieldValue !== "boolean") {
    return invalidCommand(id, type, `${field} must be a boolean.`);
  }

  return { ok: true, command: { id, type, [field]: fieldValue } };
}

function validateOptionalString(
  id: string,
  type: PiCommandType,
  value: Readonly<Record<string, unknown>>,
  field: string,
): CommandValidationResult {
  const fieldValue = readOptionalString(value, field);
  if (fieldValue === false) {
    return invalidCommand(id, type, `${field} must be a string when provided.`);
  }

  return {
    ok: true,
    command: {
      id,
      type,
      ...(fieldValue ? { [field]: fieldValue } : {}),
    },
  };
}

function validateEnumString(
  id: string,
  type: PiCommandType,
  value: Readonly<Record<string, unknown>>,
  field: string,
  options: ReadonlySet<string>,
): CommandValidationResult {
  const fieldValue = readString(value, field);
  if (!fieldValue || !options.has(fieldValue)) {
    return invalidCommand(id, type, `${field} must be one of: ${Array.from(options).join(", ")}.`);
  }

  return { ok: true, command: { id, type, [field]: fieldValue } };
}

function validateExtensionUiResponse(
  id: string,
  value: Readonly<Record<string, unknown>>,
): CommandValidationResult {
  const responseKeys = Array.from(EXTENSION_UI_RESPONSE_KEYS).filter(
    (key) => value[key] !== undefined,
  );
  if (responseKeys.length !== 1) {
    return invalidCommand(
      id,
      "extension_ui_response",
      "extension_ui_response must include exactly one response value.",
    );
  }

  if (typeof value.value === "string") {
    return { ok: true, command: { id, type: "extension_ui_response", value: value.value } };
  }

  if (typeof value.confirmed === "boolean") {
    return { ok: true, command: { id, type: "extension_ui_response", confirmed: value.confirmed } };
  }

  if (value.cancelled === true) {
    return { ok: true, command: { id, type: "extension_ui_response", cancelled: true } };
  }

  return invalidCommand(
    id,
    "extension_ui_response",
    "extension_ui_response value has an invalid type.",
  );
}

function invalidCommand(
  commandId: string,
  commandType: string,
  message: string,
): CommandValidationResult {
  return {
    ok: false,
    commandId,
    commandType,
    error: {
      code: "invalid_command",
      message,
    },
  };
}

function readString(value: Readonly<Record<string, unknown>>, field: string): string | undefined {
  const fieldValue = value[field];
  return typeof fieldValue === "string" && fieldValue.length > 0 ? fieldValue : undefined;
}

function readOptionalString(
  value: Readonly<Record<string, unknown>>,
  field: string,
): string | false | undefined {
  const fieldValue = value[field];
  if (fieldValue === undefined) {
    return undefined;
  }

  return typeof fieldValue === "string" ? fieldValue : false;
}

function readOptionalEnumString(
  value: Readonly<Record<string, unknown>>,
  field: string,
  options: ReadonlySet<string>,
): string | false | undefined {
  const fieldValue = readOptionalString(value, field);
  if (fieldValue === undefined || fieldValue === false) {
    return fieldValue;
  }

  return options.has(fieldValue) ? fieldValue : false;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
