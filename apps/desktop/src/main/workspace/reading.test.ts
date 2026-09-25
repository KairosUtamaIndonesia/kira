import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../test-support/temp.ts';
import { readWorkspaceFile } from './reading.ts';

function folderWith(files: Record<string, Buffer | string>): string {
  const root = tempDir('foundry-read-');

  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(root, name), contents);
  }

  return root;
}

/** The text a file reads as, or the sentence it is refused with. */
type Case = { name: string; files: Record<string, Buffer | string>; path: string } & (
  | { want: string }
  | { fails: RegExp }
);

const CASES: Case[] = [
  {
    name: 'a file is read as the text it holds',
    files: { 'a.ts': 'const one = 1;\n' },
    path: 'a.ts',
    want: 'const one = 1;\n',
  },
  {
    name: 'a file holding nothing reads as nothing',
    files: { 'empty.ts': '' },
    path: 'empty.ts',
    want: '',
  },
  {
    name: 'a file that is not text is refused rather than drawn',
    files: { 'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x00, 0x47]) },
    path: 'logo.png',
    fails: /^Error: This file is not text\.$/,
  },
  {
    name: 'a file larger than the cap says so instead of being read',
    files: { 'big.txt': Buffer.alloc(1024 * 1024 + 1, 0x61) },
    path: 'big.txt',
    fails: /larger than the 1 MB/,
  },
  {
    name: 'a file that is not there is a failure rather than an empty file',
    files: {},
    path: 'gone.ts',
    fails: /ENOENT/,
  },
];

for (const testCase of CASES) {
  test(testCase.name, async () => {
    const root = folderWith(testCase.files);

    if ('want' in testCase) {
      assert.equal(await readWorkspaceFile(root, testCase.path), testCase.want);
      return;
    }

    await assert.rejects(readWorkspaceFile(root, testCase.path), testCase.fails);
  });
}
