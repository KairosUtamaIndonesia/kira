import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { WorkspaceGitStatus } from '../../preload/bridge.ts';
import { type WorkspaceGitDeps, workspaceGitHandlers } from './workspaceGit.ts';

const status: WorkspaceGitStatus = {
  branch: 'main',
  ahead: null,
  behind: null,
  staged: [],
  unstaged: [{ path: 'a.txt', status: 'M' }],
  untracked: [],
};

/** Deps that record what they were asked, with the checkout fixed at `/work/api`. */
function deps(calls: string[], overrides: Partial<WorkspaceGitDeps> = {}): WorkspaceGitDeps {
  return {
    workspaceOf: (chatId) => {
      calls.push(`workspace of ${chatId}`);
      return '/work/api';
    },
    status: async (root) => {
      calls.push(`status ${root}`);
      return status;
    },
    patch: async (root, path, staged) => {
      calls.push(`patch ${root}:${path}:${staged}`);
      return 'diff';
    },
    stage: async (root, paths) => {
      calls.push(`stage ${root}:${paths.join(',')}`);
    },
    unstage: async (root, paths) => {
      calls.push(`unstage ${root}:${paths.join(',')}`);
    },
    applyHunk: async (root, patch, reverse) => {
      calls.push(`hunk ${root}:${patch}:${reverse}`);
    },
    commit: async (root, message) => {
      calls.push(`commit ${root}:${message}`);
    },
    revert: async (root, path) => {
      calls.push(`revert ${root}:${path}`);
    },
    branches: async (root) => {
      calls.push(`branches ${root}`);
      return { branches: ['main'], current: 'main' };
    },
    checkout: async (root, branch) => {
      calls.push(`checkout ${root}:${branch}`);
    },
    log: async (root, limit) => {
      calls.push(`log ${root}:${limit}`);
      return [];
    },
    commitFiles: async (root, hash) => {
      calls.push(`files ${root}:${hash}`);
      return [];
    },
    sync: async (root, action) => {
      calls.push(`sync ${root}:${action}`);
      return 'done';
    },
    ...overrides,
  };
}

test('status reads the checkout of the chat it was asked about', async () => {
  const calls: string[] = [];
  const handlers = workspaceGitHandlers(deps(calls));

  assert.deepEqual(await handlers.status('c1'), { ok: true, value: status });
  assert.deepEqual(calls, ['workspace of c1', 'status /work/api']);
});

test('a chat with no workspace yet is refused in words, not shown as clean', async () => {
  const calls: string[] = [];
  const handlers = workspaceGitHandlers(deps(calls, { workspaceOf: () => null }));

  const answer = await handlers.status('c1');
  assert.deepEqual(answer, { ok: false, error: 'This chat has no workspace yet.' });
});

test('a path that climbs out of the workspace is refused before git runs', async () => {
  const calls: string[] = [];
  const handlers = workspaceGitHandlers(deps(calls));

  const answer = await handlers.patch('c1', '../secret', false);
  assert.equal(answer.ok, false);
  assert.deepEqual(calls, ['workspace of c1']);
});

test('staging names the chat’s workspace and the paths checked against it', async () => {
  const calls: string[] = [];
  const handlers = workspaceGitHandlers(deps(calls));

  assert.deepEqual(await handlers.stage('c1', ['a.txt', 'src/b.ts']), { ok: true, value: null });
  assert.deepEqual(calls, ['workspace of c1', 'stage /work/api:a.txt,src/b.ts']);
});

test('a stage with no files named is refused', async () => {
  const calls: string[] = [];
  const handlers = workspaceGitHandlers(deps(calls));

  const answer = await handlers.stage('c1', []);
  assert.equal(answer.ok, false);
  assert.deepEqual(calls, ['workspace of c1']);
});

test('a patch is read in the index or the working tree, and only one of the two', async () => {
  const calls: string[] = [];
  const handlers = workspaceGitHandlers(deps(calls));

  assert.deepEqual(await handlers.patch('c1', 'a.txt', true), { ok: true, value: 'diff' });
  assert.deepEqual(calls, ['workspace of c1', 'patch /work/api:a.txt:true']);

  const bad = await handlers.patch('c1', 'a.txt', 'yes');
  assert.equal(bad.ok, false);
});

test('an over-large hunk is refused rather than sent to git', async () => {
  const calls: string[] = [];
  const handlers = workspaceGitHandlers(deps(calls));

  const answer = await handlers.applyHunk('c1', 'x'.repeat(1024 * 1024 + 1), false);
  assert.equal(answer.ok, false);
  assert.deepEqual(calls, ['workspace of c1']);
});

test('sync refuses an action that is not fetch, pull or push', async () => {
  const calls: string[] = [];
  const handlers = workspaceGitHandlers(deps(calls));

  const answer = await handlers.sync('c1', 'rebase');
  assert.equal(answer.ok, false);
  assert.deepEqual(calls, ['workspace of c1']);

  assert.deepEqual(await handlers.sync('c1', 'push'), { ok: true, value: 'done' });
});

test('a branch has to be named to be switched to', async () => {
  const calls: string[] = [];
  const handlers = workspaceGitHandlers(deps(calls));

  const answer = await handlers.checkout('c1', '');
  assert.equal(answer.ok, false);
  assert.deepEqual(calls, ['workspace of c1']);
});
