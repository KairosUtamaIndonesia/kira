import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { WorkspaceEntry } from '../../preload/bridge.ts';
import { type Read, type Reads, type Row, readingOf, rowsIn } from './workspaceRows.ts';

function folder(name: string, path: string): WorkspaceEntry {
  return { name, path, kind: 'folder' };
}

function file(name: string, path: string): WorkspaceEntry {
  return { name, path, kind: 'file' };
}

/**
 * What one folder answered, with nothing marked: the cases about structure are
 * not about git, so they say nothing changed.
 */
function read(...entries: WorkspaceEntry[]): Read {
  return { kind: 'entries', entries, filtered: true, changed: [] };
}

/** A folder git answered for, and the paths in it that git reports as changed. */
function marked(entries: WorkspaceEntry[], changed: string[] | null): Read {
  return { kind: 'entries', entries, filtered: true, changed };
}

function held(...pairs: [string, Read][]): Reads {
  return new Map(pairs);
}

/** What an unopened folder holds until it is read. */
function unread(path: string): Row {
  return { kind: 'notice', id: `/${path}`, label: 'Not read yet.', opens: path };
}

interface Case {
  name: string;
  read: Reads;
  /** The folder whose contents are being drawn. */
  folder: string;
  want: Row[];
}

const CASES: Case[] = [
  {
    name: 'a folder nobody has read has nothing under it',
    read: held(),
    folder: '',
    want: [],
  },
  {
    name: 'the workspace draws what has been read of it',
    read: held(['', read(folder('src', 'src'), file('a.ts', 'a.ts'))]),
    folder: '',
    want: [
      { kind: 'folder', path: 'src', name: 'src', unopened: true, children: [unread('src')] },
      { kind: 'file', path: 'a.ts', name: 'a.ts', changed: false },
    ],
  },
  {
    name: 'a folder nobody has read says so under it, and that row is what reads it',
    read: held(['', read(folder('src', 'src'))]),
    folder: '',
    want: [{ kind: 'folder', path: 'src', name: 'src', unopened: true, children: [unread('src')] }],
  },
  {
    name: 'a folder that has been opened carries what it holds',
    read: held(['', read(folder('src', 'src'))], ['src', read(file('a.ts', 'src/a.ts'))]),
    folder: '',
    want: [
      {
        kind: 'folder',
        path: 'src',
        name: 'src',
        unopened: false,
        children: [{ kind: 'file', path: 'src/a.ts', name: 'a.ts', changed: false }],
      },
    ],
  },
  {
    name: 'only the levels that have been opened are drawn, however deep they go',
    read: held(
      ['', read(folder('apps', 'apps'), folder('packages', 'packages'))],
      ['apps', read(folder('desktop', 'apps/desktop'))],
      ['apps/desktop', read(folder('src', 'apps/desktop/src'))],
    ),
    folder: '',
    want: [
      {
        kind: 'folder',
        path: 'apps',
        name: 'apps',
        unopened: false,
        children: [
          {
            kind: 'folder',
            path: 'apps/desktop',
            name: 'desktop',
            unopened: false,
            children: [
              {
                kind: 'folder',
                path: 'apps/desktop/src',
                name: 'src',
                unopened: true,
                children: [unread('apps/desktop/src')],
              },
            ],
          },
        ],
      },
      {
        kind: 'folder',
        path: 'packages',
        name: 'packages',
        unopened: true,
        children: [unread('packages')],
      },
    ],
  },
  {
    name: 'a file git reports as changed is marked, and the one beside it is not',
    read: held([
      '',
      marked([file('a.ts', 'a.ts'), file('b.ts', 'b.ts')], ['a.ts', 'src/deep/c.ts']),
    ]),
    folder: '',
    want: [
      { kind: 'file', path: 'a.ts', name: 'a.ts', changed: true },
      { kind: 'file', path: 'b.ts', name: 'b.ts', changed: false },
    ],
  },
  {
    name: 'a folder is not marked for what changed under it',
    read: held(['', marked([folder('src', 'src')], ['src/a.ts'])]),
    folder: '',
    want: [{ kind: 'folder', path: 'src', name: 'src', unopened: true, children: [unread('src')] }],
  },
  {
    name: 'nothing is marked when git cannot say what has changed',
    read: held(['', marked([file('a.ts', 'a.ts')], null)]),
    folder: '',
    want: [{ kind: 'file', path: 'a.ts', name: 'a.ts', changed: false }],
  },
  {
    name: 'a folder with nothing in it says so where its contents would be',
    read: held(['', read(folder('empty', 'empty'))], ['empty', read()]),
    folder: '',
    want: [
      {
        kind: 'folder',
        path: 'empty',
        name: 'empty',
        unopened: false,
        children: [{ kind: 'notice', id: '/empty', label: 'Nothing in this folder.' }],
      },
    ],
  },
  {
    name: 'a folder that could not be read says why where it was opened',
    read: held(
      ['', read(folder('private', 'private'))],
      ['private', { kind: 'failed', reason: 'EACCES: permission denied' }],
    ),
    folder: '',
    want: [
      {
        kind: 'folder',
        path: 'private',
        name: 'private',
        unopened: false,
        children: [{ kind: 'notice', id: '/private', label: 'EACCES: permission denied' }],
      },
    ],
  },
  {
    name: 'a folder that was answered with no workspace draws nothing',
    read: held(['', { kind: 'no-workspace' }]),
    folder: '',
    want: [],
  },
];

for (const testCase of CASES) {
  test(testCase.name, () => {
    assert.deepEqual(rowsIn(testCase.read, testCase.folder), testCase.want);
  });
}

interface AnswerCase {
  name: string;
  result: Parameters<typeof readingOf>[0];
  want: Read;
}

const ANSWER_CASES: AnswerCase[] = [
  {
    name: 'a folder comes back as what it holds, and what is marked in it',
    result: {
      ok: true,
      value: { entries: [folder('src', 'src')], filtered: false, changed: ['a.ts'] },
    },
    want: {
      kind: 'entries',
      entries: [folder('src', 'src')],
      filtered: false,
      changed: ['a.ts'],
    },
  },
  {
    name: 'a chat with no workspace comes back as none, not as an empty folder',
    result: { ok: true, value: null },
    want: { kind: 'no-workspace' },
  },
  {
    name: 'a failure comes back as the reason it failed',
    result: { ok: false, error: 'ENOENT: no such file or directory' },
    want: { kind: 'failed', reason: 'ENOENT: no such file or directory' },
  },
];

for (const testCase of ANSWER_CASES) {
  test(testCase.name, () => {
    assert.deepEqual(readingOf(testCase.result), testCase.want);
  });
}
