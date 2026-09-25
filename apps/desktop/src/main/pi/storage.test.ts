import { strict as assert } from 'node:assert';

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { tempDir } from '../test-support/temp.ts';
import { ThreadStore } from '../db/threads.ts';
import { createThread, openThread } from './storage.ts';

function tempStorePath(): string {
  return join(tempDir('kira-threads-'), 'threads.db');
}

/**
 * pi stores sessions as JSON lines, so keys holding `undefined` are not
 * persisted — by pi's own writer or by ours. Compare against the stored form.
 */
function asStored<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test('a conversation survives closing and reopening', () => {
  const path = tempStorePath();
  const store = new ThreadStore(path);
  const thread = createThread(store, join(tmpdir(), 'kira-space'));

  thread.sessionManager.appendMessage({ role: 'user', content: 'remember this', timestamp: 1 });
  const labeled = thread.sessionManager.appendMessage({
    role: 'user',
    content: 'and this',
    timestamp: 2,
  });
  thread.sessionManager.appendLabelChange(labeled, 'important');

  const before = thread.sessionManager.getEntries();
  const headerBefore = thread.sessionManager.getHeader();
  // The label is a tree entry of its own, so it becomes the leaf.
  const leafBefore = thread.sessionManager.getLeafId();
  assert.notEqual(leafBefore, labeled);
  store.close();

  const reopened = new ThreadStore(path);
  const restored = openThread(reopened, thread.threadId);

  assert.deepEqual(restored.sessionManager.getEntries(), asStored(before));
  assert.deepEqual(restored.sessionManager.getHeader(), asStored(headerBefore));
  assert.equal(restored.sessionManager.getLeafId(), leafBefore);
  reopened.close();
});

test('opening a chat does not change its activity order', () => {
  const path = tempStorePath();
  const store = new ThreadStore(path);
  const older = createThread(store, join(tmpdir(), 'kira-older-space'));

  older.sessionManager.appendMessage({ role: 'user', content: 'older', timestamp: 1 });

  const newer = createThread(store, join(tmpdir(), 'kira-newer-space'));
  newer.sessionManager.appendMessage({ role: 'user', content: 'newer', timestamp: 2 });
  const before = store.listThreads().map((thread) => thread.id);
  assert.deepEqual(before, [newer.threadId, older.threadId]);

  openThread(store, older.threadId);

  assert.deepEqual(
    store.listThreads().map((thread) => thread.id),
    before,
  );
  store.close();
});

test('a remembered place that is no longer stored is passed over', () => {
  const path = tempStorePath();
  const store = new ThreadStore(path);
  const thread = createThread(store, join(tmpdir(), 'kira-space'));
  const question = thread.sessionManager.appendMessage({
    role: 'user',
    content: 'say hi',
    timestamp: 1,
  });

  // What a remembered place becomes once the entry under it has gone: opening
  // rewrites entries, and one of those rewrites can leave the id behind.
  store.setHead(thread.threadId, 'gone');

  // Opening stands where pi would have anyway, on the entry stored last.
  assert.equal(openThread(store, thread.threadId).sessionManager.getLeafId(), question);
  store.close();
});

test('entries are written to the database, not to pi session files', () => {
  const path = tempStorePath();
  const store = new ThreadStore(path);
  const thread = createThread(store, join(tmpdir(), 'kira-space'));

  thread.sessionManager.appendMessage({ role: 'user', content: 'hello', timestamp: 1 });

  assert.equal(thread.sessionManager.getSessionFile(), undefined);
  assert.equal(thread.sessionManager.isPersisted(), false);
  store.close();

  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db
    .prepare('SELECT type FROM entries WHERE thread_id = ? ORDER BY seq')
    .all(thread.threadId) as {
    type: string;
  }[];
  db.close();

  // The header is written without ever passing through pi's `_persist`, and the
  // user message is stored even though no assistant has replied yet — pi's own
  // file writer defers in that case, which would have dropped it.
  assert.deepEqual(
    rows.map((row) => row.type),
    ['session', 'message'],
  );
});

test('threads keep their entries to themselves', () => {
  const path = tempStorePath();
  const store = new ThreadStore(path);
  const first = createThread(store, join(tmpdir(), 'space-a'));
  const second = createThread(store, join(tmpdir(), 'space-b'), {
    parentThreadId: first.threadId,
  });

  first.sessionManager.appendMessage({
    role: 'user',
    content: 'only in the first thread',
    timestamp: 1,
  });

  assert.equal(store.loadEntries(first.threadId).length, 2);
  assert.equal(store.loadEntries(second.threadId).length, 1);
  assert.equal(store.getThread(second.threadId).parentThreadId, first.threadId);
  store.close();
});
