import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { summarised } from './compactionText.ts';

interface Case {
  name: string;
  messages: number;
  lastWords: string | null;
  want: string;
}

const CASES: Case[] = [
  {
    name: 'how much went, and the last thing asked before the cut',
    messages: 3,
    lastWords: 'the config lives in deploy.toml',
    want: 'Summarised 3 earlier messages, through “the config lives in deploy.toml”',
  },
  {
    name: 'the count alone, when the cut left nothing the person asked',
    messages: 3,
    lastWords: null,
    want: 'Summarised 3 earlier messages',
  },
  {
    name: 'one message, in the singular',
    messages: 1,
    lastWords: null,
    want: 'Summarised 1 earlier message',
  },
];

for (const testCase of CASES) {
  test(`the boundary says ${testCase.name}`, () => {
    assert.equal(
      summarised({ messages: testCase.messages, lastWords: testCase.lastWords }),
      testCase.want,
    );
  });
}

test('a long question is cut short rather than moving the rule', () => {
  const long = summarised({ messages: 9, lastWords: 'x'.repeat(200) });
  const longer = summarised({ messages: 9, lastWords: 'x'.repeat(2_000) });

  assert.ok(long.includes('…'), `nothing said the quote had been cut:\n${long}`);
  assert.equal(long.length, longer.length, 'the line grew with the question it quotes');
});
