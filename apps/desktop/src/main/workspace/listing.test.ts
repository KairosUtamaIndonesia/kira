import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { WorkspaceEntry } from '../../preload/bridge.ts';
import { tempDir } from '../test-support/temp.ts';
import { childrenOf, listFolder } from './listing.ts';

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
  const root = tempDir('foundry-folder-');
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
  const root = tempDir('foundry-folder-');
  mkdirSync(join(root, 'deep'));
  writeFileSync(join(root, 'deep', 'inner.ts'), '');

  assert.deepEqual(await listFolder(root, 'deep'), {
    entries: [file('inner.ts', 'deep/inner.ts')],
    filtered: false,
    changed: null,
  });
});

test('a folder that is not there is a failure, not an empty folder', async () => {
  const root = tempDir('foundry-folder-');

  await assert.rejects(listFolder(root, 'gone'), /ENOENT/);
});
