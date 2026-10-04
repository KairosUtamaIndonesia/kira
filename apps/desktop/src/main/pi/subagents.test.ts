import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ThreadStore } from '../db/threads.ts';
import { tempDir } from '../test-support/temp.ts';
import {
  subagents,
  type SubagentDriver,
  type SubagentEnding,
  type SubagentSummary,
} from './subagents.ts';

function storePath(): string {
  return join(tempDir('kira-subagents-'), 'threads.db');
}

function driver(turn: (prompt: string) => Promise<SubagentEnding>): SubagentDriver {
  return { turn, steer: async () => {}, stop: async () => {}, dispose: () => {} };
}

test('a delegated child is its own thread, from a clean brief', async () => {
  const store = new ThreadStore(storePath());
  const chat = store.createThread(tmpdir());

  const manager = subagents({
    store,
    parentThreadId: chat.id,
    cwd: chat.cwd,
    modelId: 'served-model',
    run: async () => driver(async () => ({ kind: 'reported', report: 'Nothing to report.' })),
  });

  const childId = manager.spawn({ role: 'explore', prompt: 'Where is the retry defined?' });

  const [child] = store.listSubagents(chat.id);
  assert.ok(child, 'the child is stored under its chat');
  assert.notEqual(childId, chat.id);
  assert.equal(child.parentThreadId, chat.id);
  assert.equal(child.subagent?.role, 'explore');
  assert.equal(child.subagent?.context, 'task');
  assert.equal(child.subagent?.status, 'running');
  assert.equal(child.subagent?.prompt, 'Where is the retry defined?');
  // The child's window is its own: the chat holds none of it.
  assert.deepEqual(store.loadEntries(chat.id), []);

  // Let the in-flight child finish before the store closes, so a late write
  // never races the teardown.
  await manager.settle();
  store.close();
});

test('a child that reports writes its outcome down and hands it back', async () => {
  const store = new ThreadStore(storePath());
  const chat = store.createThread(tmpdir());
  const settled: SubagentSummary[] = [];

  const manager = subagents({
    store,
    parentThreadId: chat.id,
    cwd: chat.cwd,
    modelId: 'served-model',
    run: async () =>
      driver(async () => ({ kind: 'reported', report: 'It is in session.ts, line 12.' })),
    onSettled: (summary) => settled.push(summary),
  });

  const childId = manager.spawn({ role: 'explore', prompt: 'Find the retry.' });
  await manager.settle();

  const child = store.getThread(childId).subagent;
  assert.equal(child?.status, 'complete');
  assert.equal(child?.response, 'It is in session.ts, line 12.');
  assert.equal(child?.error, null);
  assert.notEqual(child?.endedAt, null);
  assert.deepEqual(
    settled.map((summary) => [summary.state, summary.outcome]),
    [['complete', 'It is in session.ts, line 12.']],
  );
  store.close();
});

test('a child that fails records the failure rather than a report', async () => {
  const store = new ThreadStore(storePath());
  const chat = store.createThread(tmpdir());

  const manager = subagents({
    store,
    parentThreadId: chat.id,
    cwd: chat.cwd,
    modelId: 'served-model',
    run: async () => driver(async () => ({ kind: 'failed', error: 'The model would not answer.' })),
  });

  const childId = manager.spawn({ role: 'explore', prompt: 'Find the retry.' });
  await manager.settle();

  const child = store.getThread(childId).subagent;
  assert.equal(child?.status, 'error');
  assert.equal(child?.error, 'The model would not answer.');
  assert.equal(child?.response, '');
  store.close();
});

test('list reports what the chat delegated, and where each child stands', async () => {
  const store = new ThreadStore(storePath());
  const chat = store.createThread(tmpdir());

  const manager = subagents({
    store,
    parentThreadId: chat.id,
    cwd: chat.cwd,
    modelId: 'served-model',
    run: async () => driver(async () => ({ kind: 'reported', report: 'done' })),
  });

  assert.deepEqual(manager.list(), []);

  const childId = manager.spawn({ role: 'explore', prompt: 'Find the retry.' });
  assert.deepEqual(
    manager.list().map((summary) => [summary.id, summary.state, summary.role]),
    [[childId, 'running', 'explore']],
  );

  await manager.settle();
  assert.deepEqual(
    manager.list().map((summary) => [summary.id, summary.state, summary.outcome]),
    [[childId, 'complete', 'done']],
  );
  store.close();
});

test('a child can be steered, stopped, and resumed in its own session', async () => {
  const store = new ThreadStore(storePath());
  const chat = store.createThread(tmpdir());
  const turns: string[] = [];
  let started!: () => void;
  let finishFirst!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const firstTurn = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  const steered: string[] = [];
  const manager = subagents({
    store,
    parentThreadId: chat.id,
    cwd: chat.cwd,
    modelId: 'served-model',
    run: async () => ({
      turn: async (prompt) => {
        turns.push(prompt);
        if (prompt === 'first') {
          started();
          await firstTurn;
        }
        return { kind: 'reported', report: `finished: ${prompt}` };
      },
      steer: async (text) => {
        steered.push(text);
      },
      stop: async () => {
        finishFirst();
      },
      dispose: () => {},
    }),
  });

  const childId = manager.spawn({ role: 'explore', prompt: 'first' });
  await firstStarted;
  await manager.steer(childId, 'focus on the parser');
  assert.deepEqual(steered, ['focus on the parser']);
  await manager.stop(childId);
  assert.equal(store.getThread(childId).subagent?.status, 'stopped');
  await manager.resume(childId, 'second');
  await manager.settle();
  assert.deepEqual(turns, ['first', 'second']);
  assert.equal(store.getThread(childId).subagent?.response, 'finished: second');
  store.close();
});

test('a chat refuses a fourth simultaneous child clearly', async () => {
  const store = new ThreadStore(storePath());
  const chat = store.createThread(tmpdir());
  const completions: (() => void)[] = [];
  const manager = subagents({
    store,
    parentThreadId: chat.id,
    cwd: chat.cwd,
    modelId: 'served-model',
    run: async () => ({
      turn: async () =>
        new Promise((resolve) => {
          completions.push(() => resolve({ kind: 'reported', report: 'done' }));
        }),
      steer: async () => {},
      stop: async () => completions.shift()?.(),
      dispose: () => {},
    }),
  });

  for (let index = 0; index < 3; index += 1) {
    manager.spawn({ role: 'explore', prompt: `task ${index}` });
  }
  assert.throws(
    () => manager.spawn({ role: 'explore', prompt: 'one too many' }),
    /already has 3 subagents running/,
  );
  await manager.stopAll();
  await manager.settle();
  assert.deepEqual(
    manager.list().map((child) => child.state),
    ['stopped', 'stopped', 'stopped'],
  );
  store.close();
});

test('a child question is answered through its owning chat', async () => {
  const store = new ThreadStore(storePath());
  const chat = store.createThread(tmpdir());
  const forwarded: string[] = [];
  const manager = subagents({
    store,
    parentThreadId: chat.id,
    cwd: chat.cwd,
    modelId: 'served-model',
    answerParent: async (_childId, question) => {
      forwarded.push(question);
      return 'Use the existing Redis cache.';
    },
    run: async () => driver(async () => ({ kind: 'reported', report: 'done' })),
  });

  const childId = manager.spawn({ role: 'explore', prompt: 'Investigate the cache.' });
  assert.equal(
    await manager.askParent(childId, 'Which cache is already in use?'),
    'Use the existing Redis cache.',
  );
  assert.deepEqual(forwarded, ['Which cache is already in use?']);
  await manager.settle();
  store.close();
});
