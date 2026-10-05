/**
 * The few things the Changes view's list and its review draw the same way: a
 * file's git letter, its added and removed lines, and the mono figure style.
 */
import {
  colorVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';

export const parts = stylex.create({
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  added: { color: colorVars['--color-text-green'] },
  removed: { color: colorVars['--color-text-red'] },
  counts: { display: 'inline-flex', gap: spacingVars['--spacing-1'] },
});

/** git's code for a file as the one letter people know it by; a file git does not track yet is U. */
export function Letter({ status }: { status: string }) {
  const letter = status[0] === '?' ? 'U' : (status[0] ?? '');

  return (
    <span
      {...stylex.props(parts.mono, letter === 'A' && parts.added, letter === 'D' && parts.removed)}
    >
      {letter}
    </span>
  );
}

/** Lines added and removed, or nothing for a file git cannot count. */
export function Counts({ added, removed }: { added: number | null; removed: number | null }) {
  if (added === null && removed === null) return null;

  return (
    <span {...stylex.props(parts.mono, parts.counts)}>
      {added !== null && added > 0 && <span {...stylex.props(parts.added)}>+{added}</span>}
      {removed !== null && removed > 0 && <span {...stylex.props(parts.removed)}>−{removed}</span>}
    </span>
  );
}
