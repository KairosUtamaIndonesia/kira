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

type OpenAgentThreadMeta = {
  threadId: string;
  panelId: string;
  title: string;
};

type OpenAgentThread = OpenAgentThreadMeta & {
  state: AgentThreadRuntimeState | undefined;
};

const runtimeEntries = new Map<string, AgentThreadRuntimeEntry>();
const titleGenerations = new Map<string, AgentThreadTitleGenerationState>();
const openThreads = new Map<string, OpenAgentThreadMeta>();
const idleTitleGeneration = { status: "idle" } as const satisfies AgentThreadTitleGenerationState;
const panelUnreadNotifications = new Set<string>();

const listeners = new Set<() => void>();
let snapshotVersion = 0;
let cachedOpenThreads: OpenAgentThread[] = [];
let cachedOpenThreadsVersion = -1;

function notify() {
  snapshotVersion += 1;
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

export function registerOpenAgentThread(meta: OpenAgentThreadMeta) {
  const existing = openThreads.get(meta.threadId);
  if (
    existing !== undefined &&
    existing.panelId === meta.panelId &&
    existing.title === meta.title
  ) {
    return;
  }
  openThreads.set(meta.threadId, meta);
  notify();
}

export function unregisterOpenAgentThread(threadId: string) {
  if (openThreads.delete(threadId)) {
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

export function useOpenAgentThreads(): OpenAgentThread[] {
  return useSyncExternalStore(subscribe, getOpenAgentThreadsSnapshot);
}

export function useAgentThreadRuntimeStateById(
  threadId: string | undefined,
): AgentThreadRuntimeState | undefined {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => {
      if (threadId === undefined) {
        return;
      }
      const entry = runtimeEntries.get(threadId);
      return entry !== undefined ? entry.state : undefined;
    }, [threadId]),
  );
}

export function markPanelUnread(panelId: string): void {
  if (panelUnreadNotifications.has(panelId)) return;
  panelUnreadNotifications.add(panelId);
  notify();
}

export function clearPanelUnread(panelId: string): void {
  if (!panelUnreadNotifications.has(panelId)) return;
  panelUnreadNotifications.delete(panelId);
  notify();
}

export function usePanelUnread(panelId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => {
      return panelId !== undefined && panelUnreadNotifications.has(panelId);
    }, [panelId]),
  );
}

function getOpenAgentThreadsSnapshot(): OpenAgentThread[] {
  if (cachedOpenThreadsVersion === snapshotVersion) {
    return cachedOpenThreads;
  }
  cachedOpenThreads = Array.from(openThreads.values(), (meta) => {
    const entry = runtimeEntries.get(meta.threadId);
    return { ...meta, state: entry === undefined ? undefined : entry.state };
  });
  cachedOpenThreadsVersion = snapshotVersion;
  return cachedOpenThreads;
}

export type { AgentThreadTitleGenerationState, OpenAgentThread };
