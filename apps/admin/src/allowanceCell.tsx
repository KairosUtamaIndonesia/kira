import { Badge } from '@astryxdesign/core/Badge';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { colorVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import type { Reading } from './api/allowances';
import type { Loaded } from './api/result';
import type { ListedUser } from './api/users';
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
  primary: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
    width: '100%',
  },
  amount: {
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  change: {
    backgroundColor: colorVars['--color-background-surface'],
    borderColor: colorVars['--color-border'],
    borderStyle: 'solid',
    borderWidth: 1,
    minWidth: '44px',
    minHeight: '44px',
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
 * What one person has spent against their allowance, and the way to change it.
 *
 * A reading that failed shows a dash rather than a page that cannot be drawn: one
 * person's month being unreadable is not a reason to lose the list.
 */
export default function AllowanceCell({
  user,
  reading,
  onEdit,
}: {
  user: ListedUser;
  reading: Loaded<Reading> | undefined;
  onEdit: (user: ListedUser) => void;
}) {
  if (reading === undefined || !reading.ok) {
    return <Text color="secondary">—</Text>;
  }

  const summary = summaryOf(reading.value);

  return (
    <div {...stylex.props(styles.details)}>
      <div {...stylex.props(styles.primary)}>
        <Text {...stylex.props(styles.amount)}>{summary.text}</Text>
        <Tooltip content="Change allowance" placement="above">
          <IconButton
            {...stylex.props(styles.change)}
            label="Change allowance"
            variant="secondary"
            size="sm"
            icon={
              <svg
                aria-hidden="true"
                focusable="false"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
              </svg>
            }
            onClick={() => onEdit(user)}
          />
        </Tooltip>
      </div>
      <div {...stylex.props(styles.metadata)}>
        <Text {...stylex.props(styles.note)} color="secondary" size="sm">
          {summary.note}
        </Text>
        {summary.warned ? <Badge label="near the limit" variant="warning" /> : null}
        {summary.refused > 0 ? <Badge label={`${summary.refused} refused`} variant="error" /> : null}
      </div>
    </div>
  );
}
