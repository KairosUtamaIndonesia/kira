import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { FolderListing, WorkspaceEntry } from '../../preload/bridge.ts';
import { type FileDeps, fileHandlers, type Watching } from './files.ts';

const source: WorkspaceEntry = { name: 'src', path: 'src', kind: 'folder' };
const listing: FolderListing = { entries: [source], filtered: true, changed: [source.path] };

/**
 * What the workbench may read is decided here and nowhere else: the window names
 * a chat and a path inside that chat's workspace, and the folder itself comes
 * from the chat's own record. That is why the workspace, the listing and the
 * reading are all handed in — a chat with no workspace, an unreadable folder and
 * a path climbing out are reachable without touching a filesystem.
 */
interface Case {
  name: string;
  makeDeps: (calls: string[]) => FileDeps;
  /** The two calls that take a chat and a path; watching takes a window too. */
  call: 'list' | 'read';
  chatId?: unknown;
  path?: unknown;
  want: unknown;
  wantCalls: string[];
}

/** Deps that record what they were asked for; `overrides` replace one of them. */
function deps(calls: string[], overrides: Partial<FileDeps> = {}): FileDeps {
  return {
    workspaceOf: (chatId) => {
      calls.push(`workspace of ${chatId}`);
      return '/work/api';
    },
    list: async (root, path) => {
      calls.push(`list ${root}:${path}`);
      return listing;
    },
    read: async (root, path) => {
      calls.push(`read ${root}:${path}`);
      return 'const one = 1;\n';
    },
    watch: (folders) => {
      calls.push(`watch ${folders.join(' ')}`);
      return watching(calls, folders.join(' '));
    },
    ...overrides,
  };
}

/** A watch that says so when it is stopped, the way the levels it watches do. */
function watching(calls: string[], levels: string): Watching {
  return {
    stop: () => {
      calls.push(`stop watching ${levels}`);
    },
  };
}

const CASES: Case[] = [
  {
    name: 'list reads the workspace root the chat works in',
    makeDeps: (calls) => deps(calls),
    call: 'list',
    chatId: 'c1',
    path: '',
    want: { ok: true, value: listing },
    wantCalls: ['workspace of c1', 'list /work/api:'],
  },
  {
    name: 'list reads the folder it was named, by a path from the root',
    makeDeps: (calls) => deps(calls),
    call: 'list',
    chatId: 'c1',
    path: 'src',
    want: { ok: true, value: listing },
    wantCalls: ['workspace of c1', 'list /work/api:src'],
  },
  {
    name: 'a chat with no workspace is nothing to show rather than a failure',
    makeDeps: (calls) =>
      deps(calls, {
        workspaceOf: () => null,
        list: () => assert.fail('a folder was listed for a chat with no workspace'),
      }),
    call: 'list',
    chatId: 'draft',
    path: '',
    want: { ok: true, value: null },
    wantCalls: [],
  },
  {
    name: 'a path that climbs out of the workspace is refused',
    makeDeps: (calls) => deps(calls, { list: () => assert.fail('a folder was listed') }),
    call: 'list',
    chatId: 'c1',
    path: '../../etc',
    want: { ok: false, error: 'That path is outside the chat’s workspace.' },
    wantCalls: ['workspace of c1'],
  },
  {
    name: 'an absolute path is refused, whatever it names',
    makeDeps: (calls) => deps(calls, { list: () => assert.fail('a folder was listed') }),
    call: 'list',
    chatId: 'c1',
    path: '/etc/passwd',
    want: { ok: false, error: 'That path is outside the chat’s workspace.' },
    wantCalls: ['workspace of c1'],
  },
  {
    name: 'a path that is not a path is refused before the workspace is even looked for',
    makeDeps: (calls) => deps(calls, { list: () => assert.fail('a folder was listed') }),
    call: 'list',
    chatId: 'c1',
    path: 42,
    want: {
      ok: false,
      error: 'The workbench asks for a path inside the workspace, and that was not one.',
    },
    wantCalls: [],
  },
  {
    name: 'a chat that was not named is refused',
    makeDeps: (calls) => deps(calls, { list: () => assert.fail('a folder was listed') }),
    call: 'list',
    path: '',
    want: { ok: false, error: 'A workspace is read for a chat, and none was named.' },
    wantCalls: [],
  },
  {
    name: 'a folder that cannot be read is a failure reported as a value',
    makeDeps: (calls) =>
      deps(calls, {
        list: async () => {
          throw new Error('EACCES: permission denied');
        },
      }),
    call: 'list',
    chatId: 'c1',
    path: 'private',
    want: { ok: false, error: 'EACCES: permission denied' },
    wantCalls: ['workspace of c1'],
  },
  {
    name: 'read hands over the text of the file the chat holds',
    makeDeps: (calls) => deps(calls),
    call: 'read',
    chatId: 'c1',
    path: 'src/a.ts',
    want: { ok: true, value: 'const one = 1;\n' },
    wantCalls: ['workspace of c1', 'read /work/api:src/a.ts'],
  },
  {
    name: 'read refuses the workspace itself, which is a folder and not a file',
    makeDeps: (calls) => deps(calls, { read: () => assert.fail('a folder was read as a file') }),
    call: 'read',
    chatId: 'c1',
    path: '',
    want: { ok: false, error: 'A file has to be named to be read.' },
    wantCalls: ['workspace of c1'],
  },
  {
    name: 'read refuses a chat with no workspace',
    makeDeps: (calls) =>
      deps(calls, {
        workspaceOf: () => null,
        read: () => assert.fail('a file was read for a chat with no workspace'),
      }),
    call: 'read',
    chatId: 'draft',
    path: 'a.ts',
    want: { ok: false, error: 'This chat has no workspace yet.' },
    wantCalls: [],
  },
  {
    name: 'read refuses a path outside the workspace',
    makeDeps: (calls) => deps(calls, { read: () => assert.fail('a file was read') }),
    call: 'read',
    chatId: 'c1',
    path: '../elsewhere/a.ts',
    want: { ok: false, error: 'That path is outside the chat’s workspace.' },
    wantCalls: ['workspace of c1'],
  },
  {
    name: 'read reports a file that cannot be read as a value',
    makeDeps: (calls) =>
      deps(calls, {
        read: async () => {
          throw new Error('This file is not text.');
        },
      }),
    call: 'read',
    chatId: 'c1',
    path: 'logo.png',
    want: { ok: false, error: 'This file is not text.' },
    wantCalls: ['workspace of c1'],
  },
];

for (const testCase of CASES) {
  test(testCase.name, async () => {
    const calls: string[] = [];
    const handlers = fileHandlers(testCase.makeDeps(calls));

    const answer = await handlers[testCase.call](testCase.chatId, testCase.path);

    assert.deepEqual(answer, testCase.want);
    assert.deepEqual(calls, testCase.wantCalls);
  });
}

interface WatchStep {
  call: 'watch' | 'unwatch';
  /** Which window is asking, which is what a watch is held for. */
  key: number;
  chatId?: unknown;
  /** The levels the pane is showing, by path from the workspace root. */
  paths?: unknown;
}

interface WatchCase {
  name: string;
  /** Deps that differ from the ordinary ones; the folder is `/work/api` otherwise. */
  makeDeps?: (calls: string[]) => FileDeps;
  steps: WatchStep[];
  want: unknown[];
  wantCalls: string[];
}

/**
 * A watch is held per window, and one set of levels per window at a time: the
 * pane shows one chat, so asking again is the pane moving rather than a second
 * watch, and what it was watching is stopped rather than left behind.
 *
 * A chat with nothing said in it has no folder to watch, which is the same
 * answer as listing it rather than a failure — and levels the platform will not
 * watch are not a failure either, because the tree reads them just the same.
 * Nothing is thrown at the pane for a watch that could not be started.
 */
const WATCH_CASES: WatchCase[] = [
  {
    name: 'watching takes the folder the chat works in',
    steps: [{ call: 'watch', key: 1, chatId: 'c1' }],
    want: [{ ok: true, value: null }],
    wantCalls: ['workspace of c1', 'watch /work/api'],
  },
  {
    name: 'the levels the pane is showing are watched, by paths from the workspace root',
    steps: [{ call: 'watch', key: 1, chatId: 'c1', paths: ['', 'src', 'src/deep'] }],
    want: [{ ok: true, value: null }],
    wantCalls: ['workspace of c1', 'watch /work/api /work/api/src /work/api/src/deep'],
  },
  {
    name: 'a level that climbs out of the workspace is refused',
    steps: [{ call: 'watch', key: 1, chatId: 'c1', paths: ['../elsewhere'] }],
    want: [{ ok: false, error: 'That path is outside the chat’s workspace.' }],
    wantCalls: ['workspace of c1'],
  },
  {
    name: 'levels that are not a list of paths are refused',
    steps: [{ call: 'watch', key: 1, chatId: 'c1', paths: 'src' }],
    want: [
      {
        ok: false,
        error: 'The workbench asks for the levels it is showing, and that was not a list.',
      },
    ],
    wantCalls: ['workspace of c1'],
  },
  {
    name: 'a level that is not a path is refused',
    steps: [{ call: 'watch', key: 1, chatId: 'c1', paths: [7] }],
    want: [
      {
        ok: false,
        error: 'The workbench asks for a path inside the workspace, and that was not one.',
      },
    ],
    wantCalls: ['workspace of c1'],
  },
  {
    name: 'a chat with no workspace has nothing to watch',
    makeDeps: (calls) =>
      deps(calls, {
        workspaceOf: () => null,
        watch: () => assert.fail('a folder was watched for a chat with no workspace'),
      }),
    steps: [{ call: 'watch', key: 1, chatId: 'draft' }],
    want: [{ ok: true, value: null }],
    wantCalls: [],
  },
  {
    name: 'a chat that was not named is refused',
    steps: [{ call: 'watch', key: 1 }],
    want: [{ ok: false, error: 'A workspace is read for a chat, and none was named.' }],
    wantCalls: [],
  },
  {
    name: 'a level the platform will not watch is not a failure, and leaves nothing to stop',
    makeDeps: (calls) =>
      deps(calls, {
        watch: (folders) => {
          calls.push(`watch ${folders.join(' ')}`);
          return null;
        },
      }),
    steps: [
      { call: 'watch', key: 1, chatId: 'c1' },
      { call: 'unwatch', key: 1 },
    ],
    want: [
      { ok: true, value: null },
      { ok: true, value: null },
    ],
    wantCalls: ['workspace of c1', 'watch /work/api'],
  },
  {
    name: 'watching again for one window is the pane moving, so the first watch is stopped',
    steps: [
      { call: 'watch', key: 1, chatId: 'c1' },
      { call: 'watch', key: 1, chatId: 'c1' },
    ],
    want: [
      { ok: true, value: null },
      { ok: true, value: null },
    ],
    wantCalls: [
      'workspace of c1',
      'watch /work/api',
      'workspace of c1',
      'stop watching /work/api',
      'watch /work/api',
    ],
  },
  {
    name: 'two windows watch the same folder without either being stopped',
    steps: [
      { call: 'watch', key: 1, chatId: 'c1' },
      { call: 'watch', key: 2, chatId: 'c1' },
    ],
    want: [
      { ok: true, value: null },
      { ok: true, value: null },
    ],
    wantCalls: ['workspace of c1', 'watch /work/api', 'workspace of c1', 'watch /work/api'],
  },
  {
    name: 'unwatching stops what that window was watching',
    steps: [
      { call: 'watch', key: 1, chatId: 'c1' },
      { call: 'unwatch', key: 1 },
    ],
    want: [
      { ok: true, value: null },
      { ok: true, value: null },
    ],
    wantCalls: ['workspace of c1', 'watch /work/api', 'stop watching /work/api'],
  },
  {
    name: 'unwatching a window that watches nothing is not a failure',
    steps: [{ call: 'unwatch', key: 7 }],
    want: [{ ok: true, value: null }],
    wantCalls: [],
  },
  {
    name: 'one window moving on does not stop another window watching',
    steps: [
      { call: 'watch', key: 1, chatId: 'c1' },
      { call: 'watch', key: 2, chatId: 'c1' },
      { call: 'unwatch', key: 1 },
    ],
    want: [
      { ok: true, value: null },
      { ok: true, value: null },
      { ok: true, value: null },
    ],
    wantCalls: [
      'workspace of c1',
      'watch /work/api',
      'workspace of c1',
      'watch /work/api',
      'stop watching /work/api',
    ],
  },
];

for (const testCase of WATCH_CASES) {
  test(testCase.name, async () => {
    const calls: string[] = [];
    const handlers = fileHandlers(testCase.makeDeps?.(calls) ?? deps(calls));

    const answers: unknown[] = [];

    for (const step of testCase.steps) {
      answers.push(
        step.call === 'watch'
          ? await handlers.watch(step.key, step.chatId, step.paths ?? [''], () => {})
          : await handlers.unwatch(step.key),
      );
    }

    assert.deepEqual(answers, testCase.want);
    assert.deepEqual(calls, testCase.wantCalls);
  });
}
