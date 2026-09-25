import type { Reading } from './api/allowances';

/**
 * A token count as a person reads one.
 *
 * Millions and thousands rather than every digit: an allowance is a fairness
 * number, and "20,000,000 of 20,000,000" is a wall of digits nobody compares at a
 * glance. One decimal place is enough to tell 12.3M from 12.4M, which is as fine
 * as a number this size is worth reading at.
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;

  return String(tokens);
}

/** When a refusal happened, in the reader's own time. */
export function formatWhen(at: string): string {
  const when = new Date(at);

  return Number.isNaN(when.getTime()) ? at : when.toLocaleString();
}

/** What the allowance column says about one person. */
export interface AllowanceSummary {
  /** How much of their allowance they have spent, as a person reads it. */
  text: string;
  /** Whether the number is theirs, or the one everybody gets. */
  note: string;
  /** Whether they are close enough to their allowance to be told. */
  warned: boolean;
  /** How many requests were turned away this month. */
  refused: number;
}

export function summaryOf(reading: Reading): AllowanceSummary {
  return {
    text: `${formatTokens(reading.used)} of ${formatTokens(reading.allowance)}`,
    note: reading.override === null ? 'default' : 'their own',
    warned: reading.warned,
    refused: reading.refusals.length,
  };
}
