import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ChatMessage } from '../../preload/bridge.ts';
import { messagesShowingActions } from './lineActions.ts';

/**
 * Where the row of actions goes: under the words a turn ended up with, rather
 * than under the step of work that came before them. The cases are a
 * conversation at a time, because which message carries the row depends on what
 * follows it.
 */
interface Case {
  name: string;
  conversation: ChatMessage[];
  /** The messages that draw the row, in the order they are drawn. */
  want: string[];
}

/** A question, which is only ever words. */
function you(id: string, parentId: string | null): ChatMessage {
  return { id, parentId, role: 'you', parts: [{ type: 'text', text: 'Do it' }] };
}

/** A reply that only worked: what Kira thought, and a tool Kira ran. */
function step(id: string, parentId: string | null): ChatMessage {
  return {
    id,
    parentId,
    role: 'kira',
    parts: [{ type: 'work', reasoning: 'Checking the folder.', durationMs: 19, calls: [] }],
  };
}

/** A reply that says something, with a step of work before the words. */
function answered(id: string, parentId: string | null): ChatMessage {
  return {
    id,
    parentId,
    role: 'kira',
    parts: [
      { type: 'work', reasoning: null, durationMs: 19, calls: [] },
      { type: 'text', text: 'Created fruits.md.' },
    ],
  };
}

const CASES: Case[] = [
  {
    name: 'a question and the answer that holds the words each keep a row',
    conversation: [you('a', null), answered('b', 'a')],
    want: ['a', 'b'],
  },
  {
    name: 'the step that only ran tools gives its row to the words below it',
    conversation: [you('a', null), step('b', 'a'), answered('c', 'b')],
    want: ['a', 'c'],
  },
  {
    name: 'a step nothing follows keeps its row, being all the turn has',
    conversation: [you('a', null), step('b', 'a')],
    want: ['a', 'b'],
  },
  {
    name: 'every step of a long turn but the words is passed over',
    conversation: [you('a', null), step('b', 'a'), step('c', 'b'), answered('d', 'c')],
    want: ['a', 'd'],
  },
  {
    name: 'a step before a question keeps its row, as that question ends the turn',
    conversation: [you('a', null), step('b', 'a'), you('c', 'b')],
    want: ['a', 'b', 'c'],
  },
  {
    name: 'a conversation with nothing in it has no rows',
    conversation: [],
    want: [],
  },
];

for (const { name, conversation, want } of CASES) {
  test(name, () => {
    const showing = messagesShowingActions(conversation);

    assert.deepEqual(
      conversation.map((message) => message.id).filter((id) => showing.has(id)),
      want,
    );
  });
}
