import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ChatUsage } from '../../preload/bridge';
import { type ChatLine, chatLines, formatTokens, warningFor } from './allowanceText.ts';

test('a token count is said in millions and thousands', () => {
  assert.equal(formatTokens(20_000_000), '20.0M');
  assert.equal(formatTokens(17_234_567), '17.2M');
  assert.equal(formatTokens(1_250_000), '1.3M');
  assert.equal(formatTokens(4_800), '4.8k');
  assert.equal(formatTokens(900), '900');
  assert.equal(formatTokens(0), '0');
});

test('the warning names both numbers, because one alone says nothing', () => {
  assert.equal(
    warningFor({ allowance: 20_000_000, used: 17_234_567, warned: true }),
    "17.2M of this month's 20.0M tokens are spent.",
  );
});

/**
 * What the tooltip says about the chat itself, as a case sets it up.
 *
 * The window is the model's own, so a case says what the chat holds out of what
 * the model takes — and the percentage is the one a reader works out from those
 * two numbers, not one pi handed over.
 */
const CHAT_CASES: Array<{
  name: string;
  usage: ChatUsage;
  want: ChatLine[];
}> = [
  {
    name: 'a chat nothing has been said in reads as empty, not as unknown',
    usage: { spent: 0, context: { tokens: 0, window: 128_000 } },
    want: [
      { label: 'This chat', value: '0 tokens' },
      { label: 'Context', value: '0 of 128.0k (0%)' },
    ],
  },
  {
    name: 'what the chat cost and how full it is are two lines',
    usage: { spent: 12_345, context: { tokens: 45_000, window: 272_000 } },
    want: [
      { label: 'This chat', value: '12.3k tokens' },
      { label: 'Context', value: '45.0k of 272.0k (17%)' },
    ],
  },
  {
    name: 'a chat that has spent more than a million is still one line',
    usage: { spent: 2_000_000, context: { tokens: 272_000, window: 272_000 } },
    want: [
      { label: 'This chat', value: '2.0M tokens' },
      { label: 'Context', value: '272.0k of 272.0k (100%)' },
    ],
  },
  {
    name: 'a window pi cannot measure is left out rather than called empty',
    usage: { spent: 900, context: null },
    want: [{ label: 'This chat', value: '900 tokens' }],
  },
];

for (const testCase of CHAT_CASES) {
  test(testCase.name, () => {
    assert.deepEqual(chatLines(testCase.usage), testCase.want);
  });
}
