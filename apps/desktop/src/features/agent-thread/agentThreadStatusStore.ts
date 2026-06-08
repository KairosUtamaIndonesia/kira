<<<<<<< New base: refactor(admin): move breadcrumbs into shell header
import { useCallback, useSyncExternalStore } from "react";

import type { AgentThreadRuntimeState } from "./hooks/useAgentThreadConnection";

type AgentThreadTitleGenerationState =
  | { status: "idle" }
  | { status: "generating" }
  | { status: "done" };

type AgentThreadStatusEntry = {
  id: string;
  state: AgentThreadRuntimeState;
  titleGeneration: AgentThreadTitleGenerationState;
};

const entries = new Map<string, AgentThreadStatusEntry>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function setAgentThreadRuntimeState(
  id: string,
  state: AgentThreadRuntimeState | undefined,
  titleGeneration?: AgentThreadTitleGenerationState,
) {
  if (state === undefined) {
    if (entries.has(id)) {
      entries.delete(id);
      notify();
    }
    return;
  }

  const existing = entries.get(id);
  const nextTitleGeneration =
    titleGeneration ?? (existing !== undefined ? existing.titleGeneration : undefined) ?? { status: "idle" };
  entries.set(id, { id, state, titleGeneration: nextTitleGeneration });
  notify();
}

export function setAgentThreadTitleGenerationState(id: string, titleGeneration: AgentThreadTitleGenerationState) {
  const existing = entries.get(id);
  if (existing !== undefined) {
    entries.set(id, { ...existing, titleGeneration });
    notify();
  }
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function useAgentThreadRuntimeState(): AgentThreadRuntimeState | undefined {
  const entry = useSyncExternalStore(
    subscribe,
    useCallback(() => {
      // Return the most recently updated entry (last in insertion order)
      let lastEntry: AgentThreadStatusEntry | undefined;
      for (const e of entries.values()) {
        lastEntry = e;
      }
      return lastEntry;
    }, []),
  );
  return entry !== undefined ? entry.state : undefined;
}

export function useAgentThreadTitleGenerationState(threadId: string): AgentThreadTitleGenerationState {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => {
      const existing = entries.get(threadId);
      return existing !== undefined ? existing.titleGeneration : { status: "idle" };
    }, [threadId]),
  );
}

export type { AgentThreadTitleGenerationState };
|||||||
=======
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
>>>>>>> Current commit: feat(agent-thread): add auto-generated titles, inline rename, and status bar int
