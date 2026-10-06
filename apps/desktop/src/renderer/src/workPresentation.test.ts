import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ChatMessage, ChatPart } from '../../preload/bridge';
import { runningTurnMessages, workPartsByMessage } from './workPresentation.ts';

const call = (
  name: string,
  durationMs: number | null,
): Extract<ChatPart, { type: 'work' }>['calls'][number] => ({
  name,
  target: null,
  status: durationMs === null ? 'running' : 'complete',
  durationMs,
  output: null,
  additions: null,
  deletions: null,
});

test('presents work grouped by answer and turn boundaries', () => {
  const cases: {
    name: string;
    messages: ChatMessage[];
    verify: (grouped: Map<string, readonly ChatPart[]>) => void;
  }[] = [
    {
      name: 'combines work across assistant steps until answer text',
      messages: [
        {
          id: 'first',
          parentId: 'user',
          role: 'kira',
          parts: [
            { type: 'work', reasoning: 'Inspecting.', durationMs: 25, calls: [call('read', 25)] },
          ],
        },
        {
          id: 'second',
          parentId: 'first',
          role: 'kira',
          parts: [
            { type: 'work', reasoning: 'Checking.', durationMs: 40, calls: [call('grep', 40)] },
          ],
        },
        {
          id: 'answer',
          parentId: 'second',
          role: 'kira',
          parts: [{ type: 'text', text: 'Done.' }],
        },
      ],
      verify: (grouped) => {
        const work = grouped.get('first')?.[0];
        assert.equal(work?.type, 'work');
        if (work?.type !== 'work') throw new Error('Expected a work group');
        assert.equal(work.reasoning, 'Inspecting.\n\nChecking.');
        assert.deepEqual(
          work.calls.map((each) => each.name),
          ['read', 'grep'],
        );
        assert.equal(work.durationMs, 65);
        assert.deepEqual(grouped.get('second'), []);
        assert.deepEqual(grouped.get('answer'), [{ type: 'text', text: 'Done.' }]);
      },
    },
    {
      name: 'keeps separate user turns in separate groups',
      messages: [
        {
          id: 'work-1',
          parentId: null,
          role: 'kira',
          parts: [{ type: 'work', reasoning: null, durationMs: null, calls: [] }],
        },
        {
          id: 'answer-1',
          parentId: 'work-1',
          role: 'kira',
          parts: [{ type: 'text', text: 'First.' }],
        },
        {
          id: 'user-2',
          parentId: 'answer-1',
          role: 'you',
          parts: [{ type: 'text', text: 'Again.' }],
        },
        {
          id: 'work-2',
          parentId: 'user-2',
          role: 'kira',
          parts: [{ type: 'work', reasoning: null, durationMs: null, calls: [] }],
        },
      ],
      verify: (grouped) => {
        assert.equal(grouped.get('work-1')?.length, 1);
        assert.equal(grouped.get('work-2')?.length, 1);
      },
    },
  ];

  for (const each of cases) {
    const grouped = workPartsByMessage(each.messages);
    each.verify(grouped);
    // A second render of the same transcript must not mutate or duplicate it.
    each.verify(workPartsByMessage(each.messages));
  }
});

/** A question, which is only ever words. */
const you = (id: string): ChatMessage => ({
  id,
  parentId: null,
  role: 'you',
  parts: [{ type: 'text', text: 'Do it' }],
});

/** A reply that only worked: what Kira thought, and a tool Kira ran. */
const worked = (id: string): ChatMessage => ({
  id,
  parentId: null,
  role: 'kira',
  parts: [{ type: 'work', reasoning: 'Checking.', durationMs: 5, calls: [call('read', 5)] }],
});

/** A reply that says something, with a step of work before the words. */
const answered = (id: string): ChatMessage => ({
  id,
  parentId: null,
  role: 'kira',
  parts: [
    { type: 'work', reasoning: null, durationMs: 5, calls: [call('read', 5)] },
    { type: 'text', text: 'Done.' },
  ],
});

/**
 * Which messages count as the running turn. Everything after the last question
 * belongs to it, so a step stays live through the answer that follows it; an
 * earlier turn is history, and a chat that is not running has no live turn.
 */
const TURN_CASES: {
  name: string;
  messages: ChatMessage[];
  isRunning: boolean;
  want: string[];
}[] = [
  {
    name: 'a settled chat has no working messages',
    messages: [you('user-1'), worked('work-1'), answered('answer-1')],
    isRunning: false,
    want: [],
  },
  {
    name: 'a running turn is every message after the question',
    messages: [you('user-1'), worked('work-1'), answered('answer-1')],
    isRunning: true,
    want: ['work-1', 'answer-1'],
  },
  {
    name: 'an earlier turn is history while a later one runs',
    messages: [you('user-1'), answered('answer-1'), you('user-2'), worked('work-2')],
    isRunning: true,
    want: ['work-2'],
  },
  {
    name: 'a question nothing has answered yet has no working messages',
    messages: [you('user-1')],
    isRunning: true,
    want: [],
  },
];

for (const { name, messages, isRunning, want } of TURN_CASES) {
  test(name, () => {
    const working = runningTurnMessages(messages, isRunning);

    assert.deepEqual(
      messages.map((message) => message.id).filter((id) => working.has(id)),
      want,
    );
  });
}
