import { Badge } from '@astryxdesign/core/Badge';
import { Text } from '@astryxdesign/core/Text';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import type { Reading } from './api/allowances';
import type { Loaded } from './api/result';
import { summaryOf } from './allowanceText';

const styles = stylex.create({
  details: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacingVars['--spacing-1'],
    minWidth: 0,
    width: '100%',
  },
  amount: {
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  metadata: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: spacingVars['--spacing-1'],
    columnGap: spacingVars['--spacing-2'],
  },
  note: {
    whiteSpace: 'nowrap',
  },
});

/**
 * What one person has spent against their allowance.
 *
 * Read-only: the editor lives on the person's own page, so the table stays a list
 * to scan rather than a table of live controls (docs/adr/0005-allowances.md). A
 * reading that failed shows a dash rather than losing the whole list.
 */
export default function AllowanceCell({ reading }: { reading: Loaded<Reading> | undefined }) {
  if (reading === undefined || !reading.ok) {
    return <Text color="secondary">—</Text>;
  }

  const summary = summaryOf(reading.value);

  return (
    <div {...stylex.props(styles.details)}>
      <Text {...stylex.props(styles.amount)}>{summary.text}</Text>
      <div {...stylex.props(styles.metadata)}>
        <Text {...stylex.props(styles.note)} color="secondary" size="sm">
          {summary.note}
        </Text>
        {summary.warned ? <Badge label="near the limit" variant="warning" /> : null}
        {summary.refused > 0 ? (
          <Badge label={`${summary.refused} refused`} variant="error" />
        ) : null}
      </div>
    </div>
  );
}
