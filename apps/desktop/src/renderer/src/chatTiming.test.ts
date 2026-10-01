import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { formatRunDuration } from './chatTiming.ts';

const cases = [
  { name: 'less than a second', milliseconds: 999, want: '0s' },
  { name: 'seconds', milliseconds: 45_000, want: '45s' },
  { name: 'minutes retain two-digit seconds', milliseconds: 62_000, want: '1m 02s' },
  { name: 'hours omit seconds', milliseconds: 3_723_000, want: '1h 2m' },
  { name: 'negative clock skew clamps to zero', milliseconds: -1, want: '0s' },
];

for (const { name, milliseconds, want } of cases) {
  test(`run duration: ${name}`, () => {
    assert.equal(formatRunDuration(milliseconds), want);
  });
}
