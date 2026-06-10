import { useCallback, useSyncExternalStore } from "react";

// Cross-feature channel for seeding an Agent Thread's Composer with text produced elsewhere
// (e.g. the Browser Panel element selector "Send to Thread" action). A draft is keyed by
// thread id and carries a monotonic sequence so repeated sends of identical text still
// re-trigger the consuming Composer.

type AgentThreadDraft = {
  sequence: number;
  text: string;
};

const drafts = new Map<string, AgentThreadDraft>();
const listeners = new Set<() => void>();
let nextSequence = 1;

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function setAgentThreadDraft(threadId: string, text: string) {
  drafts.set(threadId, { sequence: nextSequence, text });
  nextSequence += 1;
  notify();
}

function clearAgentThreadDraft(threadId: string) {
  if (drafts.delete(threadId)) {
    notify();
  }
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function useAgentThreadDraft(threadId: string): AgentThreadDraft | undefined {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => drafts.get(threadId), [threadId]),
  );
}

export { clearAgentThreadDraft, setAgentThreadDraft, useAgentThreadDraft, type AgentThreadDraft };
