import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { WorkspaceGitStatus } from '../../preload/bridge.ts';
import {
  changeRows,
  hunksOf,
  hunkPatch,
  canRevert,
  rowKey,
  stagedCount,
  statusWord,
  watchedFoldersOf,
} from './changesModel.ts';

const status: WorkspaceGitStatus = {
  branch: 'main',
  staged: [{ path: 'a.txt', status: 'M' }],
  unstaged: [{ path: 'b.txt', status: 'M' }],
  untracked: [{ path: 'c.txt', status: '?' }],
};

test('changed rows are staged first, then unstaged, then untracked', () => {
  assert.deepEqual(changeRows(status), [
    { group: 'staged', path: 'a.txt', status: 'M' },
    { group: 'unstaged', path: 'b.txt', status: 'M' },
    { group: 'untracked', path: 'c.txt', status: '?' },
  ]);
  assert.equal(stagedCount(status), 1);
});

test('the watched levels are the root and each changed file’s folder', () => {
  const nested: WorkspaceGitStatus = {
    branch: 'main',
    staged: [{ path: 'src/auth/login.ts', status: 'M' }],
    unstaged: [{ path: 'src/auth/session.ts', status: 'M' }],
    untracked: [
      { path: 'top.ts', status: '?' },
      { path: 'src/deep/new.ts', status: '?' },
    ],
  };
  // The root, then each changed file's folder once, with the top-level file adding none.
  assert.deepEqual(watchedFoldersOf(nested), ['', 'src/auth', 'src/deep']);
  assert.deepEqual(watchedFoldersOf(null), ['']);
});

test('a file staged and unstaged at once has two rows with different identities', () => {
  const both: WorkspaceGitStatus = {
    branch: 'main',
    staged: [{ path: 'a.txt', status: 'M' }],
    unstaged: [{ path: 'a.txt', status: 'M' }],
    untracked: [],
  };
  const rows = changeRows(both);
  assert.equal(rows.length, 2);
  assert.notEqual(rowKey(rows[0]!), rowKey(rows[1]!));
});

test('a row says git’s code in a person’s words', () => {
  const cases: { code: string; want: string }[] = [
    { code: 'M', want: 'Modified' },
    { code: 'A', want: 'Added' },
    { code: 'D', want: 'Deleted' },
    { code: 'R100', want: 'Renamed' },
    { code: 'C75', want: 'Copied' },
    { code: '?', want: 'Untracked' },
    { code: 'U', want: 'Conflicted' },
    { code: 'X', want: 'Changed' },
  ];
  for (const each of cases) assert.equal(statusWord(each.code), each.want, each.code);
});

test('only a tracked row can be reverted', () => {
  assert.equal(canRevert({ group: 'staged', path: 'a', status: 'M' }), true);
  assert.equal(canRevert({ group: 'unstaged', path: 'a', status: 'M' }), true);
  assert.equal(canRevert({ group: 'untracked', path: 'a', status: '?' }), false);
});

const PATCH = [
  'diff --git a/wide.txt b/wide.txt',
  'index 1111111..2222222 100644',
  '--- a/wide.txt',
  '+++ b/wide.txt',
  '@@ -1,3 +1,3 @@',
  '-line 1',
  '+LINE 1',
  ' line 2',
  ' line 3',
  '@@ -18,3 +18,3 @@',
  ' line 18',
  ' line 19',
  '-line 20',
  '+LINE 20',
  '',
].join('\n');

test('a patch splits into its file header and its hunks', () => {
  const { header, hunks } = hunksOf(PATCH);
  assert.equal(
    header,
    [
      'diff --git a/wide.txt b/wide.txt',
      'index 1111111..2222222 100644',
      '--- a/wide.txt',
      '+++ b/wide.txt',
    ].join('\n'),
  );
  assert.equal(hunks.length, 2);
  assert.match(hunks[0]!, /^@@ -1,3 \+1,3 @@/u);
  assert.match(hunks[0]!, /-line 1\n\+LINE 1/u);
  assert.match(hunks[1]!, /^@@ -18,3 \+18,3 @@/u);
  assert.doesNotMatch(hunks[0]!, /LINE 20/u);
});

test('one hunk comes back as a patch git can apply', () => {
  const patch = hunkPatch(PATCH, 1);
  assert.equal(
    patch,
    [
      'diff --git a/wide.txt b/wide.txt',
      'index 1111111..2222222 100644',
      '--- a/wide.txt',
      '+++ b/wide.txt',
      '@@ -18,3 +18,3 @@',
      ' line 18',
      ' line 19',
      '-line 20',
      '+LINE 20',
      '',
    ].join('\n'),
  );
  assert.equal(hunkPatch(PATCH, 9), null);
});

test('a patch with no hunks is all header', () => {
  assert.deepEqual(hunksOf('diff --git a/bin b/bin\nBinary files differ\n'), {
    header: 'diff --git a/bin b/bin\nBinary files differ\n',
    hunks: [],
  });
  assert.equal(hunkPatch('diff --git a/bin b/bin\nBinary files differ\n', 0), null);
});
