import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { WorkspaceGitStatus } from '../../preload/bridge.ts';
import {
  ageOf,
  blocksOf,
  changedFiles,
  committingCount,
  hunkLabel,
  hunksOf,
  hunkPatch,
  statusWord,
  totalsOf,
  watchedFoldersOf,
} from './changesModel.ts';

const status: WorkspaceGitStatus = {
  branch: 'main',
  ahead: null,
  behind: null,
  staged: [{ path: 'a.txt', status: 'M', added: 2, removed: 1 }],
  unstaged: [{ path: 'b.txt', status: 'M', added: 4, removed: 0 }],
  untracked: [{ path: 'c.txt', status: '?' }],
};

test('every changed path is one file, in path order, with its state', () => {
  assert.deepEqual(changedFiles(status), [
    { path: 'a.txt', status: 'M', state: 'staged', isUntracked: false, added: 2, removed: 1 },
    { path: 'b.txt', status: 'M', state: 'unstaged', isUntracked: false, added: 4, removed: 0 },
    {
      path: 'c.txt',
      status: '?',
      state: 'unstaged',
      isUntracked: true,
      added: null,
      removed: null,
    },
  ]);
});

test('a file edited after it was staged is one partial file, counted across both', () => {
  const both: WorkspaceGitStatus = {
    branch: 'main',
    ahead: null,
    behind: null,
    staged: [{ path: 'a.txt', status: 'A', added: 5, removed: 0 }],
    unstaged: [{ path: 'a.txt', status: 'M', added: 1, removed: 2 }],
    untracked: [],
  };

  assert.deepEqual(changedFiles(both), [
    { path: 'a.txt', status: 'A', state: 'partial', isUntracked: false, added: 6, removed: 2 },
  ]);
});

test('a file git cannot count has no counts rather than zero', () => {
  const binary: WorkspaceGitStatus = {
    branch: 'main',
    ahead: null,
    behind: null,
    staged: [],
    unstaged: [{ path: 'logo.png', status: 'M' }],
    untracked: [],
  };

  assert.equal(changedFiles(binary)[0]?.added, null);
});

test('a commit would hold every file with something staged', () => {
  const files = changedFiles(status);
  assert.equal(committingCount(files), 1);
  assert.deepEqual(totalsOf(files), { added: 6, removed: 1 });
});

test('the watched levels are the root and each changed file’s folder', () => {
  const nested: WorkspaceGitStatus = {
    branch: 'main',
    ahead: null,
    behind: null,
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

test('a hunk is named for its section, else the line it starts on', () => {
  const cases: { hunk: string; want: string }[] = [
    {
      hunk: '@@ -12,6 +14,9 @@ export function load() {\n context',
      want: 'export function load() {',
    },
    { hunk: '@@ -1 +1 @@\n-a\n+b', want: 'Line 1' },
    { hunk: '@@ -0,0 +1,3 @@\n+a', want: 'Line 1' },
    { hunk: '@@ -40,2 +42,3 @@\n x', want: 'Line 42' },
    { hunk: 'not a hunk', want: 'Changes' },
  ];
  for (const each of cases) assert.equal(hunkLabel(each.hunk), each.want, each.hunk);
});

test('a commit’s age is as short as a chat’s', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  const cases: { date: string; want: string }[] = [
    { date: '2026-10-05T11:59:40Z', want: 'now' },
    { date: '2026-10-05T11:55:00Z', want: '5m' },
    { date: '2026-10-05T09:00:00Z', want: '3h' },
    { date: '2026-10-03T12:00:00Z', want: '2d' },
    { date: '2026-08-24T12:00:00Z', want: '6w' },
    { date: 'garbage', want: '' },
  ];
  for (const each of cases) assert.equal(ageOf(each.date, now), each.want, each.date);
});

test('a patch is split into blocks that stage on their own', () => {
  const patch = [
    'diff --git a/x b/x',
    '--- a/x',
    '+++ b/x',
    '@@ -1,2 +1,2 @@ first()',
    '-a',
    '+b',
    '@@ -20,2 +20,2 @@',
    '-c',
    '+d',
    '',
  ].join('\n');

  const blocks = blocksOf(patch, false);
  assert.deepEqual(
    blocks.map((block) => [block.label, block.staged, block.isWhole]),
    [
      ['first()', false, false],
      ['Line 20', false, false],
    ],
  );
  assert.match(
    blocks[1]!.patch,
    /^diff --git a\/x b\/x\n--- a\/x\n\+\+\+ b\/x\n@@ -20,2 \+20,2 @@\n-c\n\+d\n$/,
  );
  assert.deepEqual(blocksOf(null, false), []);
  assert.deepEqual(blocksOf('  \n', true), []);

  const binary = 'diff --git a/i.png b/i.png\nBinary files differ\n';
  assert.deepEqual(
    blocksOf(binary, true).map((block) => [block.staged, block.isWhole]),
    [[true, true]],
  );
});
