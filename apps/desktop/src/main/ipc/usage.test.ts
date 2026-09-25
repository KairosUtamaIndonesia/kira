import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Usage } from '../../preload/bridge.ts';
import { usageHandlers } from './usage.ts';

const READING: Usage = { allowance: 20_000_000, used: 3_000_000, warned: false };

interface Case {
  name: string;
  current: () => Usage | null;
  want: unknown;
}

const CASES: Case[] = [
  {
    name: 'the window is told the reading the main process holds',
    current: () => READING,
    want: { ok: true, value: READING },
  },
  {
    // Signed out, or the server could not be asked. Both are "I do not know", and
    // the window draws nothing rather than a full allowance nobody has spent.
    name: 'a machine with no reading answers nothing, which is not zero',
    current: () => null,
    want: { ok: true, value: null },
  },
  {
    // A handler that throws crosses the process boundary as an opaque Error,
    // which tells the window nothing, so the envelope turns it into a value.
    name: 'a reading that cannot be read is a failure, not a crash',
    current: () => {
      throw new Error('the reading is not here');
    },
    want: { ok: false, error: 'the reading is not here' },
  },
];

for (const testCase of CASES) {
  test(testCase.name, async () => {
    const handlers = usageHandlers({ current: testCase.current });

    assert.deepEqual(await handlers.load(), testCase.want);
  });
}
