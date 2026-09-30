import { Kbd } from '@astryxdesign/core/Kbd';
import { Text } from '@astryxdesign/core/Text';
import { colorVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-4'],
    paddingBlock: spacingVars['--spacing-6'],
  },
  modes: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    columnGap: spacingVars['--spacing-4'],
    margin: 0,
  },
  mode: {
    display: 'grid',
    gridColumn: '1 / -1',
    gridTemplateColumns: 'subgrid',
    alignItems: 'baseline',
    paddingBlock: spacingVars['--spacing-2'],
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  reset: { margin: 0 },
  keys: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacingVars['--spacing-4'],
    rowGap: spacingVars['--spacing-2'],
  },
  key: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
  },
});

const MODES = [
  { name: 'Build', says: 'Kira makes the requested changes in your workspace.' },
  { name: 'Spec', says: 'Kira helps shape and plan the work before building it.' },
];

/** What a chat with no messages says: where to start, and what each mode is for. */
export function EmptyThread(): ReactNode {
  return (
    <div {...stylex.props(styles.root)}>
      <Text type="large" weight="medium">
        Tell Kira what to do in this folder.
      </Text>
      <dl {...stylex.props(styles.modes)}>
        {MODES.map((mode) => (
          <div key={mode.name} {...stylex.props(styles.mode)}>
            <dt {...stylex.props(styles.reset)}>
              <Text type="label" weight="medium">
                {mode.name}
              </Text>
            </dt>
            <dd {...stylex.props(styles.reset)}>
              <Text type="supporting">{mode.says}</Text>
            </dd>
          </div>
        ))}
      </dl>
      <div {...stylex.props(styles.keys)}>
        <span {...stylex.props(styles.key)}>
          <Kbd keys="enter" />
          <Text type="supporting">send</Text>
        </span>
        <span {...stylex.props(styles.key)}>
          <Kbd keys="shift+enter" />
          <Text type="supporting">new line</Text>
        </span>
      </div>
    </div>
  );
}
