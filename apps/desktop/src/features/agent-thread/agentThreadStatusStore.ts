import { useCallback, useSyncExternalStore } from "react";

import type { AgentThreadRuntimeState } from "./hooks/useAgentThreadConnection";

type AgentThreadTitleGenerationState =
  | { status: "idle" }
  | { status: "generating" }
  | { status: "done" };

type AgentThreadRuntimeEntry = {
  id: string;
  state: AgentThreadRuntimeState;
};

const runtimeEntries = new Map<string, AgentThreadRuntimeEntry>();
const titleGenerations = new Map<string, AgentThreadTitleGenerationState>();
const idleTitleGeneration = { status: "idle" } as const satisfies AgentThreadTitleGenerationState;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function setAgentThreadRuntimeState(id: string, state: AgentThreadRuntimeState | undefined) {
  if (state === undefined) {
    if (runtimeEntries.has(id)) {
      runtimeEntries.delete(id);
      notify();
    }
    return;
  }

  runtimeEntries.set(id, { id, state });
  notify();
}

export function setAgentThreadTitleGenerationState(
  id: string,
  titleGeneration: AgentThreadTitleGenerationState,
) {
  titleGenerations.set(id, titleGeneration);
  notify();
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function useAgentThreadRuntimeState(): AgentThreadRuntimeState | undefined {
  const entry = useSyncExternalStore(
    subscribe,
    useCallback(() => {
      let lastEntry: AgentThreadRuntimeEntry | undefined;
      for (const runtimeEntry of runtimeEntries.values()) {
        lastEntry = runtimeEntry;
      }
      return lastEntry;
    }, []),
  );
  return entry !== undefined ? entry.state : undefined;
}

export function useAgentThreadTitleGenerationState(
  threadId: string | undefined,
): AgentThreadTitleGenerationState {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => {
      if (threadId === undefined) {
        return idleTitleGeneration;
      }

      const existing = titleGenerations.get(threadId);
      return existing !== undefined ? existing : idleTitleGeneration;
    }, [threadId]),
  );
}

export type { AgentThreadTitleGenerationState };
