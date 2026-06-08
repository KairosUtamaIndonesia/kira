import { useSyncExternalStore } from "react";

import type { AgentThreadRuntimeState } from "./hooks/useAgentThreadConnection";

type AgentThreadStatusEntry = {
  id: string;
  state: AgentThreadRuntimeState;
};

let currentEntry: AgentThreadStatusEntry | undefined;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function setAgentThreadRuntimeState(id: string, state: AgentThreadRuntimeState | undefined) {
  if (state === undefined) {
    if (currentEntry !== undefined && currentEntry.id === id) {
      currentEntry = undefined;
      notify();
    }
    return;
  }

  currentEntry = { id, state };
  notify();
}

export function useAgentThreadRuntimeState(): AgentThreadRuntimeState | undefined {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => (currentEntry === undefined ? undefined : currentEntry.state),
  );
}
