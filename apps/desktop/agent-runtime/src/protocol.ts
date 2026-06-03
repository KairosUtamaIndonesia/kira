import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AgentSessionEvent,
  RpcCommand,
  RpcResponse,
  RpcSessionState,
} from "@earendil-works/pi-coding-agent";

export const PROTOCOL_VERSION = 1;
export const PACKAGE_NAME = "@kira/agent-runtime";

export type CommandId = string;

export type RuntimeCommand = AppCommand | PiCommand | ExtensionUiResponseCommand;

export type AppCommand =
  | AppInitializeThreadCommand
  | AppGetRuntimeStateCommand
  | AppShutdownCommand;

export type AppInitializeThreadCommand = {
  readonly id: CommandId;
  readonly type: "app:initialize_thread";
  readonly threadId: string;
  readonly projectPath: string;
  readonly displayName?: string;
  readonly restoredMessages?: readonly AgentMessage[];
};

export type AppGetRuntimeStateCommand = {
  readonly id: CommandId;
  readonly type: "app:get_runtime_state";
};

export type AppShutdownCommand = {
  readonly id: CommandId;
  readonly type: "app:shutdown";
};

export type PiCommand = {
  readonly id: CommandId;
  readonly type: RpcCommand["type"];
} & Readonly<Record<string, unknown>>;

export type ExtensionUiResponseCommand =
  | {
      readonly id: string;
      readonly type: "extension_ui_response";
      readonly value: string;
    }
  | {
      readonly id: string;
      readonly type: "extension_ui_response";
      readonly confirmed: boolean;
    }
  | {
      readonly id: string;
      readonly type: "extension_ui_response";
      readonly cancelled: true;
    };

export type RuntimeOutput = RuntimeResponse | RuntimeEvent;

export type RuntimeResponse = AppResponse | PiResponse | RuntimeErrorResponse;

export type AppResponse =
  | {
      readonly id: CommandId;
      readonly type: "response";
      readonly command: "app:initialize_thread";
      readonly success: true;
      readonly data: {
        readonly threadId: string;
        readonly sessionId: string;
      };
    }
  | {
      readonly id: CommandId;
      readonly type: "response";
      readonly command: "app:get_runtime_state";
      readonly success: true;
      readonly data: RuntimeState;
    }
  | {
      readonly id: CommandId;
      readonly type: "response";
      readonly command: "app:shutdown";
      readonly success: true;
    };

export type PiResponse = RequireResponseId<RpcResponse>;

export type RuntimeErrorResponse = {
  readonly id: CommandId;
  readonly type: "response";
  readonly command: string;
  readonly success: false;
  readonly error: RuntimeError;
};

export type RuntimeError = {
  readonly code: RuntimeErrorCode;
  readonly message: string;
  readonly details?: unknown;
};

export type RuntimeErrorCode =
  | "invalid_json"
  | "invalid_command"
  | "thread_not_initialized"
  | "thread_already_initialized"
  | "pi_runtime_error"
  | "shutdown_error";

export type RuntimeState = {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly packageName: typeof PACKAGE_NAME;
  readonly thread?: InitializedThreadState;
  readonly pi?: RpcSessionState;
};

export type InitializedThreadState = {
  readonly threadId: string;
  readonly projectPath: string;
  readonly displayName?: string;
  readonly sessionId: string;
};

export type RuntimeEvent = AppEvent | PiWrappedEvent | ExtensionUiRequestEvent;

export type AppEvent =
  | {
      readonly type: "app:ready";
      readonly packageName: typeof PACKAGE_NAME;
      readonly protocolVersion: typeof PROTOCOL_VERSION;
    }
  | {
      readonly type: "app:error";
      readonly error: RuntimeError;
    }
  | {
      readonly type: "app:thread_initialized";
      readonly threadId: string;
      readonly sessionId: string;
    }
  | {
      readonly type: "app:persist_session_entry";
      readonly threadId: string;
      readonly sessionId: string;
      readonly entry: KiraAgentSessionEntry;
    }
  | {
      readonly type: "app:persistence_checkpoint";
      readonly threadId: string;
      readonly sessionId: string;
      readonly reason: PersistenceCheckpointReason;
      readonly messages: readonly AgentMessage[];
    }
  | {
      readonly type: "app:runtime_state_changed";
      readonly state: RuntimeState;
    };

export type PersistenceCheckpointReason = "agent_end" | "compaction_end" | "manual";

export type KiraAgentSessionEntry = {
  readonly kind: "message";
  readonly message: AgentMessage;
};

export type PiWrappedEvent = {
  readonly type: "pi:event";
  readonly threadId: string;
  readonly event: AgentSessionEvent;
};

export type ExtensionUiRequestEvent =
  | {
      readonly type: "extension_ui_request";
      readonly id: string;
      readonly method: "select";
      readonly title: string;
      readonly options: readonly string[];
      readonly timeout?: number;
    }
  | {
      readonly type: "extension_ui_request";
      readonly id: string;
      readonly method: "confirm";
      readonly title: string;
      readonly message: string;
      readonly timeout?: number;
    }
  | {
      readonly type: "extension_ui_request";
      readonly id: string;
      readonly method: "input";
      readonly title: string;
      readonly placeholder?: string;
      readonly timeout?: number;
    }
  | {
      readonly type: "extension_ui_request";
      readonly id: string;
      readonly method: "editor";
      readonly title: string;
      readonly prefill?: string;
    }
  | {
      readonly type: "extension_ui_request";
      readonly id: string;
      readonly method: "notify";
      readonly message: string;
      readonly notifyType?: "info" | "warning" | "error";
    }
  | {
      readonly type: "extension_ui_request";
      readonly id: string;
      readonly method: "setStatus";
      readonly statusKey: string;
      readonly statusText?: string;
    }
  | {
      readonly type: "extension_ui_request";
      readonly id: string;
      readonly method: "setWidget";
      readonly widgetKey: string;
      readonly widgetLines?: readonly string[];
      readonly widgetPlacement?: "aboveEditor" | "belowEditor";
    }
  | {
      readonly type: "extension_ui_request";
      readonly id: string;
      readonly method: "setTitle";
      readonly title: string;
    }
  | {
      readonly type: "extension_ui_request";
      readonly id: string;
      readonly method: "set_editor_text";
      readonly text: string;
    };

type RequireResponseId<TResponse extends { readonly id?: string }> = Omit<TResponse, "id"> & {
  readonly id: CommandId;
};
