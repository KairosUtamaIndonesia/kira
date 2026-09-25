import type { ChatUsage, Usage } from '../../preload/bridge';

/**
 * A token count as a person reads one.
 *
 * Millions and thousands rather than every digit: "17,234,567 of 20,000,000" is a
 * wall of digits nobody compares at a glance. One decimal place tells 12.3M from
 * 12.4M, which is as fine as a number this size is worth reading at.
 *
 * The console says the same thing the same way (apps/admin/src/allowanceText.ts).
 * Two copies of ten lines is the price of not having a package for them yet; the
 * third caller is when to make one.
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;

  return String(tokens);
}

/**
 * What the composer says when the month is nearly spent.
 *
 * The server decided that it is nearly spent — `warned` is its reading of its own
 * threshold — so this only says so, and says the two numbers a person needs to
 * see it coming: what they have used, and what they are allowed.
 */
export function warningFor(usage: Usage): string {
  return `${formatTokens(usage.used)} of this month's ${formatTokens(usage.allowance)} tokens are spent.`;
}

/** One line of the tooltip's reading of the chat: what it is called, and what it says. */
export interface ChatLine {
  label: string;
  value: string;
}

/**
 * What the tooltip says about the chat on screen, under the month.
 *
 * Two lines, because they measure different things and somebody reading them
 * against the month above needs to know which is which: what this chat cost, and
 * how much of its window it is holding. The percentage is worked out here from
 * the two token counts rather than carried across, so the line and the numbers
 * in it cannot disagree.
 *
 * The window line is left out when pi cannot say. A compaction leaves a gap
 * before the next reply reports what it used, and a chat that has spent tokens
 * but cannot be measured would otherwise read the same as one holding nothing.
 */
export function chatLines(usage: ChatUsage): ChatLine[] {
  const lines: ChatLine[] = [{ label: 'This chat', value: `${formatTokens(usage.spent)} tokens` }];

  if (usage.context !== null) {
    const { tokens, window } = usage.context;
    const percent = Math.round((tokens / window) * 100);

    lines.push({
      label: 'Context',
      value: `${formatTokens(tokens)} of ${formatTokens(window)} (${percent}%)`,
    });
  }

  return lines;
}
