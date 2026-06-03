import type { AgentMessage } from "@earendil-works/pi-agent-core";

import {
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  type RpcSessionState,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import type { InitializedThreadState, RuntimeEvent } from "./protocol";

export type RuntimeEventEmitter = (event: RuntimeEvent) => void;

export type PiRuntime = {
  readonly thread: InitializedThreadState;
  readonly runtime: AgentSessionRuntime;
  getState(): RpcSessionState;
  dispose(): Promise<void>;
};

export type CreatePiRuntimeOptions = {
  readonly threadId: string;
  readonly projectPath: string;
  readonly displayName?: string;
  readonly restoredMessages?: readonly AgentMessage[];
  readonly emit: RuntimeEventEmitter;
};

const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  agentDir,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
  });

  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(sessionStartEvent !== undefined ? { sessionStartEvent } : {}),
    })),
    services,
    diagnostics: services.diagnostics,
  };
};

export async function createPiRuntime(options: CreatePiRuntimeOptions): Promise<PiRuntime> {
  const agentDir = getAgentDir();
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: options.projectPath,
    agentDir,
    sessionManager: SessionManager.inMemory(options.projectPath),
  });

  if (options.restoredMessages !== undefined) {
    runtime.session.agent.state.messages = [...options.restoredMessages];
  }

  const thread = {
    threadId: options.threadId,
    projectPath: options.projectPath,
    ...(options.displayName ? { displayName: options.displayName } : {}),
    sessionId: runtime.session.sessionId,
  };

  let unsubscribe = bindSessionEvents(runtime, thread, options.emit);
  runtime.setRebindSession(async () => {
    unsubscribe();
    unsubscribe = bindSessionEvents(runtime, thread, options.emit);
  });

  return {
    thread,
    runtime,
    getState: () => getPiSessionState(runtime),
    dispose: async () => {
      unsubscribe();
      await runtime.dispose();
    },
  };
}

function bindSessionEvents(
  runtime: AgentSessionRuntime,
  thread: InitializedThreadState,
  emit: RuntimeEventEmitter,
): () => void {
  return runtime.session.subscribe((event) => {
    emit({
      type: "pi:event",
      threadId: thread.threadId,
      event,
    });

    if (event.type === "message_end") {
      emit({
        type: "app:persist_session_entry",
        threadId: thread.threadId,
        sessionId: runtime.session.sessionId,
        entry: {
          kind: "message",
          message: event.message,
        },
      });
    }

    if (event.type === "agent_end") {
      emit({
        type: "app:persistence_checkpoint",
        threadId: thread.threadId,
        sessionId: runtime.session.sessionId,
        reason: "agent_end",
        messages: event.messages,
      });
    }
  });
}

function getPiSessionState(runtime: AgentSessionRuntime): RpcSessionState {
  const session = runtime.session;
  return {
    ...(session.model !== undefined ? { model: session.model } : {}),
    thinkingLevel: session.thinkingLevel,
    isStreaming: session.isStreaming,
    isCompacting: session.isCompacting,
    steeringMode: session.steeringMode,
    followUpMode: session.followUpMode,
    ...(session.sessionFile !== undefined ? { sessionFile: session.sessionFile } : {}),
    sessionId: session.sessionId,
    ...(session.sessionName !== undefined ? { sessionName: session.sessionName } : {}),
    autoCompactionEnabled: session.autoCompactionEnabled,
    messageCount: session.messages.length,
    pendingMessageCount: session.pendingMessageCount,
  };
}
