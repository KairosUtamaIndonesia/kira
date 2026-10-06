import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { formatDuration, formatRunDuration } from './chatTiming.ts';

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

const stepCases = [
  { name: 'milliseconds while they are the useful unit', milliseconds: 250, want: '250ms' },
  { name: 'a tenth of a second under ten', milliseconds: 2_340, want: '2.3s' },
  { name: 'whole seconds past ten', milliseconds: 45_600, want: '46s' },
  { name: 'minutes and the seconds left over', milliseconds: 425_000, want: '7m 5s' },
];

for (const { name, milliseconds, want } of stepCases) {
  test(`step duration: ${name}`, () => {
    assert.equal(formatDuration(milliseconds), want);
  });
}
