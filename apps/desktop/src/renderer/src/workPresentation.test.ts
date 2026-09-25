import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ChatMessage, ChatPart } from '../../preload/bridge';
import { workPartsByMessage } from './workPresentation.ts';

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
