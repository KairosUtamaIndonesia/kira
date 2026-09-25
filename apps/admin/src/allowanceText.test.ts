import { describe, expect, test } from 'bun:test';
import { formatTokens, formatWhen, summaryOf } from './allowanceText';
import type { Reading } from './api/allowances';

describe('an allowance as a person reads it', () => {
  test('is rounded to a size somebody can compare at a glance', () => {
    expect(formatTokens(20_000_000)).toBe('20.0M');
    expect(formatTokens(12_345_678)).toBe('12.3M');
    expect(formatTokens(9_500)).toBe('9.5k');
    expect(formatTokens(120)).toBe('120');
  });

  test('says whose number it is', () => {
    expect(summaryOf(reading({ override: null })).note).toBe('default');
    expect(summaryOf(reading({ override: 5_000_000 })).note).toBe('their own');
  });

  test('counts what they were turned away for, and says when', () => {
    expect(summaryOf(reading()).refused).toBe(0);
    expect(
      summaryOf(
        reading({
          refusals: [{ at: '2026-09-05T00:00:00.000Z', model: 'm', reason: 'model_cooldown' }],
        }),
      ).refused,
    ).toBe(1);

    expect(formatWhen('2026-09-05T00:00:00.000Z')).not.toBe('2026-09-05T00:00:00.000Z');
    // A stamp the browser cannot read is shown as it arrived rather than as
    // "Invalid Date".
    expect(formatWhen('not a date')).toBe('not a date');
  });

  test('says how much of it is spent, and whether they are close', () => {
    const spent = summaryOf(reading({ used: 12_345_678, allowance: 20_000_000 }));

    expect(spent.text).toBe('12.3M of 20.0M');
    expect(spent.warned).toBe(false);

    // The warning is the server's: it is computed against the allowance the server
    // holds, and the console says what it was told rather than working it out.
    expect(summaryOf(reading({ warned: true })).warned).toBe(true);
  });
});

/** A month with only what a case here cares about. */
function reading(parts: Partial<Reading> = {}): Reading {
  return {
    allowance: 20_000_000,
    used: 0,
    warned: false,
    override: null,
    refusals: [],
    ...parts,
  };
}
