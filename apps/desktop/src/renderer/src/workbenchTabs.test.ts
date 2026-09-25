import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Result } from '../../preload/bridge.ts';
import {
  type ByChat,
  CONTEXT,
  SPEC,
  type Reading,
  WORKSPACE,
  closed,
  contentsOf,
  nameOf,
  opened,
  shown,
  tabsOf,
  valueOf,
} from './workbenchTabs.ts';

/** Every chat's tabs, as a case can say them in a line. */
function byChat(...entries: [string, { open: string[]; showing: string }][]): ByChat {
  return new Map(entries);
}

/** One chat's tabs, which is most cases. */
function one(chat: string, open: string[], showing: string): ByChat {
  return byChat([chat, { open, showing }]);
}

interface TabsCase {
  name: string;
  all: ByChat;
  chat: string;
  initialTab?: string;
  want: { open: readonly string[]; showing: string };
}

const TABS_CASES: TabsCase[] = [
  {
    name: 'a chat that has opened nothing shows Context',
    all: byChat(),
    chat: 'a',
    want: { open: [], showing: CONTEXT },
  },
  {
    name: 'a chat with files open is showing what it was showing',
    all: one('a', ['x.ts', 'y.ts'], valueOf('y.ts')),
    chat: 'a',
    want: { open: ['x.ts', 'y.ts'], showing: valueOf('y.ts') },
  },
  {
    name: 'what another chat has open is not this chat’s',
    all: one('a', ['x.ts'], valueOf('x.ts')),
    chat: 'b',
    want: { open: [], showing: CONTEXT },
  },
  {
    name: 'a newly shaping chat opens the Spec tab by default',
    all: byChat(),
    chat: 'new-chat',
    initialTab: SPEC,
    want: { open: [], showing: SPEC },
  },
  {
    name: 'the initial Spec tab does not replace a tab the person already chose',
    all: one('a', [], CONTEXT),
    chat: 'a',
    initialTab: SPEC,
    want: { open: [], showing: CONTEXT },
  },
];

for (const testCase of TABS_CASES) {
  test(testCase.name, () => {
    assert.deepEqual(tabsOf(testCase.all, testCase.chat, testCase.initialTab), testCase.want);
  });
}

interface EditCase {
  name: string;
  all: ByChat;
  chat: string;
  path: string;
  want: ByChat;
}

const OPEN_CASES: EditCase[] = [
  {
    name: 'a file that is not open is opened last and shown',
    all: one('a', ['x.ts'], CONTEXT),
    chat: 'a',
    path: 'y.ts',
    want: one('a', ['x.ts', 'y.ts'], valueOf('y.ts')),
  },
  {
    name: 'a file that is already open is brought forward, not opened twice',
    all: one('a', ['x.ts', 'y.ts'], CONTEXT),
    chat: 'a',
    path: 'x.ts',
    want: one('a', ['x.ts', 'y.ts'], valueOf('x.ts')),
  },
  {
    name: 'opening a file in one chat leaves another chat’s files where they were',
    all: byChat(
      ['a', { open: ['x.ts'], showing: CONTEXT }],
      ['b', { open: ['z.ts'], showing: valueOf('z.ts') }],
    ),
    chat: 'b',
    path: 'y.ts',
    want: byChat(
      ['a', { open: ['x.ts'], showing: CONTEXT }],
      ['b', { open: ['z.ts', 'y.ts'], showing: valueOf('y.ts') }],
    ),
  },
];

for (const testCase of OPEN_CASES) {
  test(testCase.name, () => {
    assert.deepEqual(opened(testCase.all, testCase.chat, testCase.path), testCase.want);
  });
}

const CLOSE_CASES: EditCase[] = [
  {
    name: 'closing the file that is showing shows the one that took its place',
    all: one('a', ['x.ts', 'y.ts', 'z.ts'], valueOf('y.ts')),
    chat: 'a',
    path: 'y.ts',
    want: one('a', ['x.ts', 'z.ts'], valueOf('z.ts')),
  },
  {
    name: 'closing the last file that is showing shows the one before it',
    all: one('a', ['x.ts', 'y.ts'], valueOf('y.ts')),
    chat: 'a',
    path: 'y.ts',
    want: one('a', ['x.ts'], valueOf('x.ts')),
  },
  {
    name: 'closing the only file leaves the chat’s workspace showing, since the pane stays',
    all: one('a', ['x.ts'], valueOf('x.ts')),
    chat: 'a',
    path: 'x.ts',
    want: one('a', [], WORKSPACE),
  },
  {
    name: 'closing a file that is not showing leaves what is showing alone',
    all: one('a', ['x.ts', 'y.ts'], CONTEXT),
    chat: 'a',
    path: 'x.ts',
    want: one('a', ['y.ts'], CONTEXT),
  },
  {
    name: 'closing a file the chat does not have open leaves it as it was',
    all: one('a', ['x.ts'], valueOf('x.ts')),
    chat: 'a',
    path: 'nope.ts',
    want: one('a', ['x.ts'], valueOf('x.ts')),
  },
];

for (const testCase of CLOSE_CASES) {
  test(testCase.name, () => {
    assert.deepEqual(closed(testCase.all, testCase.chat, testCase.path), testCase.want);
  });
}

interface ShowCase {
  name: string;
  all: ByChat;
  value: string;
  want: ByChat;
}

const SHOW_CASES: ShowCase[] = [
  {
    name: 'showing the tree keeps the chat’s open files',
    all: one('a', ['x.ts'], valueOf('x.ts')),
    value: WORKSPACE,
    want: one('a', ['x.ts'], WORKSPACE),
  },
  {
    name: 'showing a file the chat has open shows that file',
    all: one('a', ['x.ts', 'y.ts'], CONTEXT),
    value: valueOf('y.ts'),
    want: one('a', ['x.ts', 'y.ts'], valueOf('y.ts')),
  },
];

for (const testCase of SHOW_CASES) {
  test(testCase.name, () => {
    assert.deepEqual(shown(testCase.all, 'a', testCase.value), testCase.want);
  });
}

interface ValueCase {
  name: string;
  path: string;
  want: string;
}

const VALUE_CASES: ValueCase[] = [
  {
    name: 'a file’s tab is named by its path',
    path: 'src/deep/a.ts',
    want: 'file:src/deep/a.ts',
  },
  {
    name: 'a file called workspace is not the workspace tab',
    path: 'workspace',
    want: 'file:workspace',
  },
  {
    name: 'a file whose path begins the way a file’s tab does is still that file',
    path: 'file:x',
    want: 'file:file:x',
  },
];

for (const testCase of VALUE_CASES) {
  test(testCase.name, () => {
    assert.equal(valueOf(testCase.path), testCase.want);
  });
}

interface NameCase {
  name: string;
  path: string;
  want: string;
}

const NAME_CASES: NameCase[] = [
  {
    name: 'a file in a folder is labelled with the file’s own name',
    path: 'src/deep/a.ts',
    want: 'a.ts',
  },
  {
    name: 'a file in the workspace’s own root is labelled with its name',
    path: 'package.json',
    want: 'package.json',
  },
];

for (const testCase of NAME_CASES) {
  test(testCase.name, () => {
    assert.equal(nameOf(testCase.path), testCase.want);
  });
}

interface ReadCase {
  name: string;
  result: Result<string>;
  want: Reading;
}

const READ_CASES: ReadCase[] = [
  {
    name: 'a file comes back as the text it holds',
    result: { ok: true, value: 'export const a = 1;\n' },
    want: { kind: 'text', text: 'export const a = 1;\n' },
  },
  {
    name: 'a file that was refused comes back as the sentence, not as nothing',
    result: { ok: false, error: 'This file is not text.' },
    want: { kind: 'refused', reason: 'This file is not text.' },
  },
  {
    name: 'a file too large to read comes back as the sentence saying so',
    result: { ok: false, error: 'This file is larger than the 1 MB the workbench reads.' },
    want: { kind: 'refused', reason: 'This file is larger than the 1 MB the workbench reads.' },
  },
];

for (const testCase of READ_CASES) {
  test(testCase.name, () => {
    assert.deepEqual(contentsOf(testCase.result), testCase.want);
  });
}
