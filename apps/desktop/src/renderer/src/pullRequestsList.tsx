/**
 * The Pull requests view's list: one ruled row per request.
 *
 * A row says whether the request is open, what it is called, who opened it and
 * from which branch, what its checks came to and how long ago it moved, and
 * opens the request in the pane. Nothing on the row acts, because nothing here
 * writes.
 */
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  focusVars,
  radiusVars,
  spacingVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import type { LivePullRequest } from '../../preload/bridge';
import { ageOf } from './changesModel';
import { parts } from './changesParts';
import { ChecksIcon, StateIcon } from './pullRequestsParts';

const styles = stylex.create({
  rows: { margin: 0, padding: 0, listStyle: 'none' },
  row: {
    borderBlockEndWidth: { default: borderVars['--border-width'], ':last-child': 0 },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  open: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacingVars['--spacing-2'],
    boxSizing: 'border-box',
    width: 'calc(100% + 16px)',
    minHeight: 56,
    marginInline: -8,
    paddingBlock: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: 0,
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
    color: colorVars['--color-text-primary'],
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: '-2px',
  },
  lead: { display: 'flex', paddingBlockStart: 2, flexShrink: 0 },
  stack: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
  tail: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    flexShrink: 0,
    paddingBlockStart: 2,
  },
});

export function PullRequestRows({
  requests,
  onOpen,
}: {
  requests: readonly LivePullRequest[];
  onOpen: (number: number) => void;
}) {
  // Read once when the list is shown, so an age does not shift while it is being read.
  const [now] = useState(Date.now);

  return (
    <ul {...stylex.props(styles.rows)}>
      {requests.map((request) => (
        <li key={request.number} {...stylex.props(styles.row)}>
          <button
            type="button"
            title={request.title}
            {...stylex.props(styles.open)}
            onClick={() => onOpen(request.number)}
          >
            <span {...stylex.props(styles.lead)}>
              <StateIcon state={request.state} />
            </span>
            <span {...stylex.props(styles.stack)}>
              <Text type="label" maxLines={2}>
                {request.title}
              </Text>
              <Text type="supporting" color="secondary" maxLines={1}>
                #{request.number}
                {request.branch !== null && ` · ${request.branch}`}
              </Text>
            </span>
            <span {...stylex.props(styles.tail)}>
              <ChecksIcon state={request.checksState} />
              {request.updatedAt !== null && (
                <span {...stylex.props(parts.mono)}>{ageOf(request.updatedAt, now)}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
