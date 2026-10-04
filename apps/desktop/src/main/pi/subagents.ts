/**
 * The subagents a chat delegates.
 *
 * A child is a thread of its own (ADR 0028): it is stored like a chat, its
 * entries never reach the chat's transcript, and its terminal outcome is written
 * onto its record. This module is the bookkeeping around that — delegate a
 * child, follow it to its end, and hand the report back — while the work of
 * actually running a child's turn belongs to whoever supplies `run`, since that
 * is the part that needs a pi session and a model. Splitting it there is what
 * lets the manager be exercised on its own.
 */
import type { SubagentRecord, SubagentRole, SubagentStatus, ThreadStore } from '../db/threads.ts';

export type { SubagentRole } from '../db/threads.ts';

/** What a chat sees of one child it delegated. */
export interface SubagentSummary {
  id: string;
  role: SubagentRole;
  /** The child's task as one line, to show against it. */
  title: string;
  state: SubagentStatus;
  /** The child's report, once it has one. */
  outcome: string | null;
  error: string | null;
}

/** How a child's turn ended. */
export type SubagentEnding =
  | { kind: 'reported'; report: string }
  | { kind: 'failed'; error: string };

/**
 * Run one delegated piece of work and answer its ending.
 *
 * Supplied by the conversation layer, which is where a pi session is built and a
 * turn is taken. A test supplies one that answers directly, so the manager can
 * be exercised without a model.
 */
export type RunSubagent = (input: {
  childThreadId: string;
  role: SubagentRole;
  prompt: string;
  cwd: string;
}) => Promise<SubagentEnding>;

export interface SubagentManager {
  /** Delegate a bounded piece of work to a child, and answer its id. */
  spawn(input: { role: SubagentRole; prompt: string }): string;
  /** What this chat has delegated, oldest first. */
  list(): SubagentSummary[];
  /** Wait for every running child to reach its end. */
  settle(): Promise<void>;
  /** Stop following the children. Their records stay. */
  dispose(): void;
  /** Watch children reach their ends. Returns an unsubscribe function. */
  subscribe(listener: (summary: SubagentSummary) => void): () => void;
}

/**
 * The tools a read-only child may use: reading and looking back, nothing that
 * changes the workspace. A general child gets the chat's own tools instead.
 */
const READ_ONLY_ROLE_TOOLS = new Set(['read', 'grep', 'find', 'ls', 'recall', 'ask_user_question']);

/** Active tools for a child of `role`, out of the tools its session registered. */
export function toolsForRole(role: SubagentRole, availableTools: readonly string[]): string[] {
  if (role === 'general') return [...availableTools];
  return availableTools.filter((name) => READ_ONLY_ROLE_TOOLS.has(name));
}

/** A child's task, as one line to show against it. */
function titleOf(prompt: string): string {
  const first = prompt.trim().split('\n', 1)[0] ?? '';
  return first.length > 0 ? first : prompt.trim();
}

function summaryOf(id: string, record: SubagentRecord): SubagentSummary {
  return {
    id,
    role: record.role,
    title: titleOf(record.prompt),
    state: record.status,
    outcome: record.response === '' ? null : record.response,
    error: record.error,
  };
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The run itself, as it reaches the child's end. */
export function subagents(options: {
  store: ThreadStore;
  parentThreadId: string;
  cwd: string;
  /** The model every child of this chat runs on. */
  modelId: string;
  run: RunSubagent;
  /** Called once per child, the moment its end is written down. */
  onSettled?: (summary: SubagentSummary) => void;
}): SubagentManager {
  const { store, parentThreadId, cwd, modelId, run, onSettled } = options;
  const following = new Set<Promise<void>>();
  const listeners = new Set<(summary: SubagentSummary) => void>();
  let disposed = false;

  const summaryOfChild = (childThreadId: string): SubagentSummary => {
    const record = store.getThread(childThreadId).subagent;
    if (record === null) throw new Error(`Thread ${childThreadId} is not a subagent.`);
    return summaryOf(childThreadId, record);
  };

  const end = (childThreadId: string, ending: SubagentEnding): void => {
    if (disposed) return;
    const endedAt = new Date().toISOString();
    store.updateSubagent(
      childThreadId,
      ending.kind === 'reported'
        ? { status: 'complete', response: ending.report, error: null, endedAt }
        : { status: 'error', response: '', error: ending.error, endedAt },
    );
    const summary = summaryOfChild(childThreadId);
    onSettled?.(summary);
    for (const listener of listeners) listener(summary);
  };

  const follow = (childThreadId: string, role: SubagentRole, prompt: string): void => {
    const running: Promise<void> = run({ childThreadId, role, prompt, cwd })
      .then((ending) => end(childThreadId, ending))
      .catch((error: unknown) => end(childThreadId, { kind: 'failed', error: failureText(error) }))
      .finally(() => following.delete(running));
    following.add(running);
  };

  return {
    spawn: ({ role, prompt }) => {
      const record: SubagentRecord = {
        role,
        prompt,
        context: 'task',
        modelId,
        status: 'running',
        response: '',
        error: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
      };
      const child = store.createThread(cwd, { parentThreadId, subagent: record });
      follow(child.id, role, prompt);
      return child.id;
    },

    list: () => store.listSubagents(parentThreadId).map((thread) => summaryOfChild(thread.id)),

    settle: async () => {
      while (following.size > 0) await Promise.all([...following]);
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose: () => {
      disposed = true;
      following.clear();
    },
  };
}
