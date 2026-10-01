import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { WorkspaceEntry } from '../../preload/bridge.ts';
import { tempDir } from '../test-support/temp.ts';
import { childrenOf, listFolder, searchWorkspaceFiles } from './listing.ts';

interface Case {
  name: string;
  /** The paths git named inside the folder, relative to it, as `-z` gives them. */
  named: string[];
  /** The folder being listed, as a path from the workspace root. */
  folder: string;
  want: WorkspaceEntry[];
}

function folder(name: string, path: string): WorkspaceEntry {
  return { name, path, kind: 'folder' };
}

function file(name: string, path: string): WorkspaceEntry {
  return { name, path, kind: 'file' };
}

/**
 * What one folder holds is decided from the paths git named under it, so a
 * folder nobody has opened is never read: the levels the tree draws come from
 * the levels that have been asked for.
 */
const CASES: Case[] = [
  {
    name: 'a path with no separator in it is a file',
    named: ['a.ts', 'b.ts'],
    folder: '',
    want: [file('a.ts', 'a.ts'), file('b.ts', 'b.ts')],
  },
  {
    name: 'a path with a separator in it is a folder holding something',
    named: ['src/a.ts'],
    folder: '',
    want: [folder('src', 'src')],
  },
  {
    name: 'a folder stands above the files, whatever the alphabet says',
    named: ['zzz/a.ts', 'a.ts', 'b.ts'],
    folder: '',
    want: [folder('zzz', 'zzz'), file('a.ts', 'a.ts'), file('b.ts', 'b.ts')],
  },
  {
    name: 'each of the two is alphabetical, and case does not decide the order',
    named: ['Zebra/a.ts', 'apple/a.ts', 'B.ts', 'a.ts'],
    folder: '',
    want: [
      folder('apple', 'apple'),
      folder('Zebra', 'Zebra'),
      file('a.ts', 'a.ts'),
      file('B.ts', 'B.ts'),
    ],
  },
  {
    name: 'two names differing only in case have one fixed order, not the order git gave',
    named: ['readme.md', 'README.md'],
    folder: '',
    want: [file('README.md', 'README.md'), file('readme.md', 'readme.md')],
  },
  {
    name: 'a folder named by many paths is one row',
    named: ['src/a.ts', 'src/b.ts', 'src/deep/c.ts'],
    folder: '',
    want: [folder('src', 'src')],
  },
  {
    name: 'a file three levels down is not a row of this folder',
    named: ['a/b/c.ts'],
    folder: '',
    want: [folder('a', 'a')],
  },
  {
    name: 'the folder being listed is prefixed onto each path it holds',
    named: ['deep/b.ts', 'a.ts'],
    folder: 'src',
    want: [folder('deep', 'src/deep'), file('a.ts', 'src/a.ts')],
  },
  {
    name: 'a folder with nothing named under it has nothing drawn',
    named: [],
    folder: 'src',
    want: [],
  },
];

for (const testCase of CASES) {
  test(testCase.name, () => {
    assert.deepEqual(childrenOf(testCase.named, testCase.folder), testCase.want);
  });
}

/**
 * The other half of the walk: a folder git cannot answer for is read as it is,
 * and says that it was not filtered and that nothing is marked. Nothing here is a
 * checkout, which is what makes this the unfiltered branch whatever is on the
 * machine.
 */
test('a folder git cannot answer for is read as it is, and says so', async () => {
  const root = tempDir('kira-folder-');
  mkdirSync(join(root, 'deep'));
  writeFileSync(join(root, 'b.ts'), '');
  writeFileSync(join(root, 'a.ts'), '');
  writeFileSync(join(root, 'deep', 'inner.ts'), '');

  assert.deepEqual(await listFolder(root, ''), {
    entries: [folder('deep', 'deep'), file('a.ts', 'a.ts'), file('b.ts', 'b.ts')],
    filtered: false,
    changed: null,
  });
});

test('a folder inside one is read by its path from the workspace root', async () => {
  const root = tempDir('kira-folder-');
  mkdirSync(join(root, 'deep'));
  writeFileSync(join(root, 'deep', 'inner.ts'), '');

  assert.deepEqual(await listFolder(root, 'deep'), {
    entries: [file('inner.ts', 'deep/inner.ts')],
    filtered: false,
    changed: null,
  });
});

test('a folder that is not there is a failure, not an empty folder', async () => {
  const root = tempDir('kira-folder-');

  await assert.rejects(listFolder(root, 'gone'), /ENOENT/);
});

test('file search follows Git ignores, matches paths case-insensitively, and does not follow symlinks', async () => {
  const root = tempDir('kira-file-search-');
  const outside = tempDir('kira-file-search-outside-');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'secret'), { recursive: true });
  mkdirSync(join(outside, 'nested'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), 'secret/\n');
  writeFileSync(join(root, 'src', 'Login.ts'), 'contents are not searched');
  writeFileSync(join(root, 'docs', 'login guide.md'), '');
  writeFileSync(join(root, 'secret', 'login-token.ts'), '');
  writeFileSync(join(outside, 'login-outside.ts'), '');
  writeFileSync(join(outside, 'nested', 'login-nested.ts'), '');
  symlinkSync(join(outside, 'login-outside.ts'), join(root, 'login-link.ts'));
  symlinkSync(join(outside, 'nested'), join(root, 'linked-directory'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });

  assert.deepEqual(await searchWorkspaceFiles(root, 'LOGIN'), [
    'docs/login guide.md',
    'src/Login.ts',
  ]);
});

test('file search returns at most fifty results in stable path order', async () => {
  const root = tempDir('kira-file-search-');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  for (let index = 59; index >= 0; index -= 1) {
    writeFileSync(join(root, `login-${String(index).padStart(2, '0')}.ts`), '');
  }

  assert.deepEqual(
    await searchWorkspaceFiles(root, 'login'),
    Array.from({ length: 50 }, (_, index) => `login-${String(index).padStart(2, '0')}.ts`),
  );
});

test('file search in a non-Git workspace does not descend through linked folders', async () => {
  const root = tempDir('kira-file-search-');
  const outside = tempDir('kira-file-search-outside-');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'Login.ts'), '');
  writeFileSync(join(outside, 'login-outside.ts'), '');
  symlinkSync(outside, join(root, 'linked'));

  assert.deepEqual(await searchWorkspaceFiles(root, 'login'), ['src/Login.ts']);
});
