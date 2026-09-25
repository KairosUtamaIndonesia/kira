/**
 * Where a thread meets pi.
 *
 * Threads are stored in SQLite (`store.ts`), but pi's session manager only
 * writes to files, so this module owns the one seam between the two: hand pi an
 * in-memory manager and take its writes somewhere else. It is the only file in
 * Kira that depends on pi's private `_persist`, so it is the only file an
 * upgrade of pi can break in that way — which is why it is named after pi
 * rather than after the conversation it happens to be storing.
 */
import {
  SessionManager,
  type FileEntry,
  type SessionEntry,
  type SessionHeader,
} from '@earendil-works/pi-coding-agent';
import type { ChatMode } from '../../preload/bridge.ts';
import { parentIdOf, type ThreadStore } from '../db/threads.ts';

/**
 * A thread as pi sees it: Kira's identity and working directory, plus the
 * session manager that holds its entries.
 *
 * Distinct from `ThreadRecord`, which is how the database sees the same thread —
 * that one has no pi in it.
 */
export interface PiThread {
  threadId: string;
  cwd: string;
  sessionManager: SessionManager;
}

/** pi's entry list as stored: the header first, then the tree entries. */
function entriesOf(sessionManager: SessionManager): FileEntry[] {
  const header = sessionManager.getHeader();
  const entries = sessionManager.getEntries();

  return header ? [header, ...entries] : entries;
}

/**
 * Point pi's writes at the database instead of a JSONL file.
 *
 * `SessionManager.inMemory()` sets `persist = false`, which turns every file
 * write in pi into a no-op, so nothing is saved unless we take over here.
 * Overriding `_persist` is the only thing standing between a conversation and
 * being lost, which is why the missing-method case fails loudly rather than
 * running with persistence quietly switched off.
 */
function attachPersistence(
  store: ThreadStore,
  threadId: string,
  sessionManager: SessionManager,
): void {
  if (typeof sessionManager._persist !== 'function') {
    throw new Error(
      "Refusing to open a thread: pi's SessionManager._persist is gone, so pi would run with file persistence disabled and the conversation would not be stored anywhere.",
    );
  }

  sessionManager._persist = (entry: SessionEntry): void => {
    store.appendEntry(threadId, entry);
  };
}

export function createThread(
  store: ThreadStore,
  cwd: string,
  options: {
    id?: string;
    parentThreadId?: string;
    workspaceId?: string;
    ticketId?: string;
    mode?: ChatMode;
  } = {},
): PiThread {
  const record = store.createThread(cwd, options);
  const sessionManager = SessionManager.inMemory(cwd, { id: record.id });
  attachPersistence(store, record.id, sessionManager);

  // pi writes the header straight into its entry list, so `_persist` never sees
  // it. Reconcile once here to store it.
  store.reconcile(record.id, entriesOf(sessionManager));

  return { threadId: record.id, cwd, sessionManager };
}

/**
 * Start a new thread holding the conversation up to `messageId`, and return it
 * as pi sees it.
 *
 * This is what a fork is: the same work continued on its own. It keeps the
 * working folder for the same reason — a fresh folder would strand the files the
 * conversation is about — and it keeps the workspace for the same reason again: a
 * fork is the same work, so it is filed where that work is filed. It takes only
 * the path to `messageId`, so whatever was written on another branch stays
 * behind with the chat it was written in.
 *
 * It keeps what the source was holding, too, for the third time — but by keeping
 * the source's turns, not by being handed its answers. What the work was, which
 * files it touched and what the person asked for is worked out again from the
 * entries the fork holds, so it begins holding exactly what those turns say and
 * nothing that was said on a branch it did not take.
 *
 * pi records where a session came from in its own header, so a fork is one
 * there too, not just in our thread row.
 */
export function forkThread(
  store: ThreadStore,
  sourceThreadId: string,
  messageId: string,
): PiThread {
  const source = store.getThread(sourceThreadId);
  const stored = store.loadEntries(sourceThreadId);
  const header = stored.find((entry): entry is SessionHeader => entry.type === 'session');
  const path = pathTo(stored, messageId);
  const record = store.createThread(source.cwd, {
    parentThreadId: sourceThreadId,
    workspaceId: source.workspaceId ?? undefined,
    mode: source.mode,
  });

  // The header is the one entry that names the thread and its folder, so it is
  // rewritten rather than copied. Its version is left as the source had it
  // because the entries below it are the source's too, and a version bump here
  // would tell pi they need no migration when they might.
  const entries: FileEntry[] = [
    ...(header
      ? [
          {
            ...header,
            id: record.id,
            timestamp: new Date().toISOString(),
            cwd: record.cwd,
            parentSession: sourceThreadId,
          },
        ]
      : []),
    ...path,
  ];

  const sessionManager = SessionManager.inMemory(source.cwd, { id: record.id }, entries);
  attachPersistence(store, record.id, sessionManager);
  store.reconcile(record.id, entriesOf(sessionManager));

  return { threadId: record.id, cwd: source.cwd, sessionManager };
}

/**
 * What a chat says about an id it does not hold a message at.
 *
 * A thread's own id is its header's, and a model change is an entry pi keeps for
 * itself: both are stored, and neither is somewhere a conversation is.
 */
export function missingMessage(messageId: string): Error {
  return new Error(`This chat has no message ${messageId}.`);
}

/**
 * The chain of entries ending at `messageId`, oldest first. A conversation is a
 * tree, so the path to a message is everything it was said in reply to: the rest
 * of the thread is other branches. Refuses an id this chat never stored, rather
 * than handing back a chat that quietly starts somewhere else.
 */
function pathTo(stored: readonly FileEntry[], messageId: string): FileEntry[] {
  const byId = new Map(stored.map((entry) => [entry.id, entry]));
  const path: FileEntry[] = [];
  let entry: FileEntry | undefined = byId.get(messageId);

  // Only a message is somewhere to fork at: the path up to a model change or a
  // compaction is a chat with no conversation in it.
  if (entry?.type !== 'message') {
    throw missingMessage(messageId);
  }

  while (entry) {
    path.unshift(entry);
    const parentId = parentIdOf(entry);
    entry = parentId === null ? undefined : byId.get(parentId);
  }

  return path;
}

export function openThread(store: ThreadStore, threadId: string): PiThread {
  const record = store.getThread(threadId);
  const entries = store.loadEntries(threadId);
  const sessionManager = SessionManager.inMemory(record.cwd, { id: threadId }, entries);
  attachPersistence(store, threadId, sessionManager);

  // pi stands on the last entry stored, which is where the conversation was
  // *written*, not necessarily where it was being read: a branch switch writes
  // no entry. A remembered place is put back, as long as the entry is still
  // there — loading can rewrite entries, and an id that has gone means standing
  // where pi would have anyway.
  if (record.headId !== null && entries.some((entry) => entry.id === record.headId)) {
    sessionManager.branch(record.headId);
  }

  // Loading can rewrite entries in memory (pi migrates older session versions),
  // and those rewrites never reach `_persist`.
  store.reconcile(threadId, entriesOf(sessionManager));

  return { threadId, cwd: record.cwd, sessionManager };
}
