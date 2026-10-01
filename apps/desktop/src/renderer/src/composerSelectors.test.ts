import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ChatCommand, MagicPrompt } from '../../preload/bridge.ts';
import {
  fileReferenceValue,
  matchingCommands,
  matchingMagicPrompts,
  restoredFileReference,
  submissionFor,
} from './composerSelectors.ts';

test('file references round-trip readable workspace paths, including spaces and quotes', () => {
  const path = 'notes/Brandon said "ship it".md';
  const value = fileReferenceValue(path);

  assert.equal(value, '@file("notes/Brandon said \\"ship it\\".md")');
  assert.deepEqual(restoredFileReference(`${value}\u00a0 after`), { path, value });
});

test('file reference deserialization rejects malformed and escaping paths', () => {
  const cases = [
    { text: '@file(not-json)', want: null },
    { text: '@file("/etc/passwd")', want: null },
    { text: '@file("../outside.txt")', want: null },
    { text: 'text @file("inside.txt")', want: null },
  ] as const;

  for (const each of cases) {
    assert.deepEqual(restoredFileReference(each.text), each.want, each.text);
  }
});

test('Magic Prompts match case-insensitive names and aliases while preserving literal records', () => {
  const prompts: MagicPrompt[] = [
    { id: 'one', name: 'Review', aliases: ['audit'], content: 'Literal $1 text' },
    { id: 'two', name: 'Research', aliases: ['investigate'], content: 'Search deeply' },
  ];

  assert.deepEqual(
    matchingMagicPrompts(prompts, 'AUD'),
    [prompts[0]],
  );
  assert.equal(prompts[0]?.content, 'Literal $1 text');
});

test('slash command matching searches descriptions and keeps category data', () => {
  const commands: ChatCommand[] = [
    {
      id: 'compact',
      label: '/compact',
      description: 'Shorten this chat',
      invocation: '/compact',
      category: 'Commands',
    },
    {
      id: 'implement',
      label: 'Implement',
      description: 'Build the approved work',
      invocation: '/skill:implement',
      category: 'Skills',
    },
  ];

  assert.deepEqual(matchingCommands(commands, 'approved'), [commands[1]]);
  assert.equal(matchingCommands(commands, '').length, 2);
});

test('submission routing reserves a leading exclamation mark for one local command', () => {
  const cases = [
    { text: '! pwd', editing: false, want: { type: 'shell', command: ' pwd' } },
    { text: '!', editing: false, want: { type: 'empty-shell' } },
    { text: 'check this ! later', editing: false, want: { type: 'message', text: 'check this ! later' } },
    { text: ' ! pwd', editing: false, want: { type: 'message', text: ' ! pwd' } },
    { text: '! pwd', editing: true, want: { type: 'message', text: '! pwd' } },
    { text: '/compact', editing: false, want: { type: 'compact' } },
    { text: '/compact please', editing: false, want: { type: 'message', text: '/compact please' } },
  ] as const;

  for (const each of cases) {
    assert.deepEqual(submissionFor(each.text, each.editing), each.want, each.text);
  }
});
