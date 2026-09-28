import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../test-support/temp.ts';
import { readWorkspaceAsset, readWorkspaceFile, writeWorkspaceFile } from './reading.ts';

function folderWith(files: Record<string, Buffer | string>): string {
  const root = tempDir('kira-read-');

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

interface WriteCase {
  name: string;
  files: Record<string, Buffer | string>;
  expected: string;
  content: string;
  want?: string;
  fails?: RegExp;
}

const WRITE_CASES: WriteCase[] = [
  {
    name: 'a text file is saved when it still holds what was opened',
    files: { 'a.ts': 'before\n' },
    expected: 'before\n',
    content: 'after\n',
    want: 'after\n',
  },
  {
    name: 'a changed file is not overwritten by a stale editor',
    files: { 'a.ts': 'changed elsewhere\n' },
    expected: 'before\n',
    content: 'stale edit\n',
    fails: /changed on disk since it was opened/,
  },
  {
    name: 'a file that is not text is not written',
    files: { 'a.bin': Buffer.from([0x00, 0x01]) },
    expected: '',
    content: 'text\n',
    fails: /This file is not text/,
  },
  {
    name: 'a saved text file remains under the read size limit',
    files: { 'a.ts': 'before\n' },
    expected: 'before\n',
    content: 'x'.repeat(1024 * 1024 + 1),
    fails: /larger than the 1 MB/,
  },
];

for (const testCase of WRITE_CASES) {
  test(testCase.name, async () => {
    const root = folderWith(testCase.files);

    if (testCase.fails) {
      await assert.rejects(
        writeWorkspaceFile(
          root,
          Object.keys(testCase.files)[0]!,
          testCase.expected,
          testCase.content,
        ),
        testCase.fails,
      );
      return;
    }

    await writeWorkspaceFile(
      root,
      Object.keys(testCase.files)[0]!,
      testCase.expected,
      testCase.content,
    );
    assert.equal(await readWorkspaceFile(root, Object.keys(testCase.files)[0]!), testCase.want);
  });
}

test('a previewable binary file is returned as a bounded data URL', async () => {
  const root = folderWith({ 'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) });

  assert.deepEqual(await readWorkspaceAsset(root, 'logo.png'), {
    dataUrl: 'data:image/png;base64,iVBORw==',
    mimeType: 'image/png',
    sizeBytes: 4,
  });
});

test('binary preview refuses formats without a safe preview MIME type', async () => {
  const root = folderWith({ 'installer.exe': Buffer.from([0x00, 0x01]) });

  await assert.rejects(readWorkspaceAsset(root, 'installer.exe'), /This file type has no preview/);
});
