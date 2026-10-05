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

export const MAX_RUNNING_SUBAGENTS_PER_CHAT = 3;

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
  activity: string | null;
  /**
   * Whether this session still holds the child's own session, which is what a
   * steer, a stop or a resume needs. A child from an earlier run of the app does
   * not: its transcript can be read, but nothing more can be asked of it.
   */
  controllable: boolean;
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
export interface SubagentDriver {
  turn(prompt: string): Promise<SubagentEnding>;
  steer(text: string): Promise<void>;
  stop(): Promise<void>;
  dispose(): void;
}

export type RunSubagent = (input: {
  childThreadId: string;
  role: SubagentRole;
  prompt: string;
  cwd: string;
  activity(text: string): void;
}) => Promise<SubagentDriver>;

export interface SubagentManager {
  /** Delegate a bounded piece of work to a child, and answer its id. */
  spawn(input: { role: SubagentRole; prompt: string }): string;
  stop(childThreadId: string): Promise<void>;
  stopAll(): Promise<void>;
  steer(childThreadId: string, text: string): Promise<void>;
  resume(childThreadId: string, prompt: string): Promise<void>;
  /** Ask the owning chat to answer a child question; null means Kira cannot answer. */
  askParent(childThreadId: string, question: string): Promise<string | null>;
  /** What this chat has delegated, oldest first. */
  list(): SubagentSummary[];
  /** Wait for every running child to reach its end. */
  settle(): Promise<void>;
  /** Stop following the children. Their records stay. */
  dispose(): void;
  /** Watch children reach their ends. Returns an unsubscribe function. */
  subscribe(listener: (summary: SubagentSummary) => void): () => void;
  activity(childThreadId: string, text: string): void;
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

function summaryOf(id: string, record: SubagentRecord, controllable: boolean): SubagentSummary {
  return {
    id,
    role: record.role,
    title: titleOf(record.prompt),
    state: record.status,
    outcome: record.response === '' ? null : record.response,
    error: record.error,
    activity: record.activity ?? null,
    controllable,
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
  answerParent?: (childThreadId: string, question: string) => Promise<string | null>;
  /** Called once per child, the moment its end is written down. */
  onSettled?: (summary: SubagentSummary) => void;
}): SubagentManager {
  const { store, parentThreadId, cwd, modelId, run, answerParent, onSettled } = options;
  const following = new Set<Promise<void>>();
  const drivers = new Map<string, SubagentDriver>();
  const generations = new Map<string, number>();
  const listeners = new Set<(summary: SubagentSummary) => void>();
  let disposed = false;

  // A manager belongs to one in-memory chat session. Any run already stored when
  // that session boots was interrupted by an app exit, so it cannot still be
  // running and must not consume the chat's child limit forever.
  for (const thread of store.listSubagents(parentThreadId)) {
    if (thread.subagent?.status === 'running') {
      store.updateSubagent(thread.id, {
        status: 'stopped',
        activity: 'Stopped',
        endedAt: new Date().toISOString(),
      });
    }
  }

  const summaryOfChild = (childThreadId: string): SubagentSummary => {
    const record = store.getThread(childThreadId).subagent;
    if (record === null) throw new Error(`Thread ${childThreadId} is not a subagent.`);
    return summaryOf(childThreadId, record, drivers.has(childThreadId));
  };

  const recordForOwnedChild = (childThreadId: string): SubagentRecord => {
    const child = store.getThread(childThreadId);
    if (child.parentThreadId !== parentThreadId || child.subagent === null) {
      throw new Error('That subagent does not belong to this chat.');
    }
    return child.subagent;
  };

  const end = (childThreadId: string, generation: number, ending: SubagentEnding): void => {
    if (disposed) return;
    if (generations.get(childThreadId) !== generation) return;
    const endedAt = new Date().toISOString();
    store.updateSubagent(
      childThreadId,
      ending.kind === 'reported'
        ? { status: 'complete', response: ending.report, error: null, activity: 'Done', endedAt }
        : { status: 'error', response: '', error: ending.error, activity: 'Error', endedAt },
    );
    const summary = summaryOfChild(childThreadId);
    onSettled?.(summary);
    for (const listener of listeners) listener(summary);
  };

  const updateActivity = (childThreadId: string, text: string): void => {
    const record = store.getThread(childThreadId).subagent;
    if (disposed || record === null || record.status !== 'running') return;
    store.updateSubagent(childThreadId, { activity: text });
    const summary = summaryOfChild(childThreadId);
    for (const listener of listeners) listener(summary);
  };

  const follow = (
    childThreadId: string,
    role: SubagentRole,
    prompt: string,
    existing?: SubagentDriver,
  ): void => {
    const generation = (generations.get(childThreadId) ?? 0) + 1;
    generations.set(childThreadId, generation);
    const running: Promise<void> = (
      existing === undefined
        ? run({
            childThreadId,
            role,
            prompt,
            cwd,
            activity: (text) => updateActivity(childThreadId, text),
          }).then((driver) => {
            drivers.set(childThreadId, driver);
            return driver;
          })
        : Promise.resolve(existing)
    )
      .then((driver) => {
        if (generations.get(childThreadId) !== generation || disposed) {
          driver.dispose();
          drivers.delete(childThreadId);
          return undefined;
        }
        return driver.turn(prompt);
      })
      .then((ending) => {
        if (ending !== undefined) end(childThreadId, generation, ending);
      })
      .catch((error: unknown) =>
        end(childThreadId, generation, { kind: 'failed', error: failureText(error) }),
      )
      .finally(() => following.delete(running));
    following.add(running);
  };

  const manager: SubagentManager = {
    spawn: ({ role, prompt }) => {
      const runningCount = store
        .listSubagents(parentThreadId)
        .filter((thread) => thread.subagent?.status === 'running').length;
      if (runningCount >= MAX_RUNNING_SUBAGENTS_PER_CHAT) {
        throw new Error(
          `This chat already has ${MAX_RUNNING_SUBAGENTS_PER_CHAT} subagents running.`,
        );
      }
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

    stop: async (childThreadId) => {
      const record = recordForOwnedChild(childThreadId);
      const driver = drivers.get(childThreadId);
      if (record.status !== 'running') {
        throw new Error('That subagent is not running.');
      }
      generations.set(childThreadId, (generations.get(childThreadId) ?? 0) + 1);
      await driver?.stop();
      store.updateSubagent(childThreadId, {
        status: 'stopped',
        activity: 'Stopped',
        response: '',
        error: null,
        endedAt: new Date().toISOString(),
      });
      const summary = summaryOfChild(childThreadId);
      onSettled?.(summary);
      for (const listener of listeners) listener(summary);
    },

    stopAll: async () => {
      const active = store
        .listSubagents(parentThreadId)
        .filter((thread) => thread.subagent?.status === 'running');
      await Promise.all(active.map((thread) => manager.stop(thread.id)));
    },

    steer: async (childThreadId, text) => {
      const record = recordForOwnedChild(childThreadId);
      const driver = drivers.get(childThreadId);
      if (record.status !== 'running' || driver === undefined) {
        throw new Error('That subagent is not running.');
      }
      await driver.steer(text);
    },

    resume: async (childThreadId, prompt) => {
      const record = recordForOwnedChild(childThreadId);
      const driver = drivers.get(childThreadId);
      if (record.status === 'running') {
        throw new Error('That subagent cannot be resumed.');
      }
      if (driver === undefined) throw new Error('That subagent session is no longer available.');
      store.updateSubagent(childThreadId, {
        status: 'running',
        activity: 'Working',
        response: '',
        error: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
      });
      follow(childThreadId, record.role, prompt, driver);
      const summary = summaryOfChild(childThreadId);
      for (const listener of listeners) listener(summary);
    },

    askParent: async (childThreadId, question) => {
      recordForOwnedChild(childThreadId);
      return answerParent?.(childThreadId, question) ?? null;
    },

    settle: async () => {
      while (following.size > 0) await Promise.all([...following]);
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    activity: updateActivity,

    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const thread of store.listSubagents(parentThreadId)) {
        if (thread.subagent?.status !== 'running') continue;
        generations.set(thread.id, (generations.get(thread.id) ?? 0) + 1);
        store.updateSubagent(thread.id, {
          status: 'stopped',
          activity: 'Stopped',
          endedAt: new Date().toISOString(),
        });
      }
      for (const driver of drivers.values()) {
        void driver.stop().catch(() => {});
        driver.dispose();
      }
      drivers.clear();
    },
  };
  return manager;
}
