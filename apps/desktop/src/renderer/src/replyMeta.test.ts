import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ChatMessage, ModelOption } from '../../preload/bridge';
import { formatClockTime, formatReplyMeta, replyMetaByMessage } from './replyMeta.ts';

/** A fixed local moment, so the clock reading is the same wherever the suite runs. */
const at = new Date(2026, 0, 2, 9, 1).getTime();

test('a clock reading follows the reader’s locale', () => {
  assert.equal(formatClockTime(at, 'en-US'), '9:01 AM');
});

test('the metadata line joins what is known and drops what is not', () => {
  assert.equal(
    formatReplyMeta({ model: 'DeepSeek V4.1 Flash', durationMs: 425_000, at }),
    `DeepSeek V4.1 Flash · 7m 5s · ${formatClockTime(at)}`,
  );
  assert.equal(
    formatReplyMeta({ model: null, durationMs: 425_000, at }),
    `7m 5s · ${formatClockTime(at)}`,
  );
  assert.equal(
    formatReplyMeta({ model: 'DeepSeek V4.1 Flash', durationMs: null, at }),
    `DeepSeek V4.1 Flash · ${formatClockTime(at)}`,
  );
});

test('each reply gets its line, named by the pool and keyed by message', () => {
  const messages: ChatMessage[] = [
    { id: 'q', parentId: null, role: 'you', parts: [{ type: 'text', text: 'Do it' }] },
    {
      id: 'a',
      parentId: 'q',
      role: 'kira',
      parts: [{ type: 'text', text: 'Done.' }],
      reply: { model: 'served-model', at, durationMs: 425_000 },
    },
    {
      id: 'b',
      parentId: 'a',
      role: 'kira',
      parts: [{ type: 'text', text: 'Done.' }],
      reply: { model: 'gone-model', at, durationMs: null },
    },
  ];
  const models: ModelOption[] = [{ id: 'served-model', name: 'Served Model' }];

  const meta = replyMetaByMessage(messages, models);

  assert.deepEqual([...meta.keys()], ['a', 'b']);
  assert.equal(meta.get('a'), `Served Model · 7m 5s · ${formatClockTime(at)}`);
  assert.equal(meta.get('b'), `gone-model · ${formatClockTime(at)}`);
});
