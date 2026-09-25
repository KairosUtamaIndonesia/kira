/**
 * What Kira is holding, drawn as the workbench's Context tab.
 *
 * Not in the conversation and not part of it: this is the chat's memory of the
 * work — the goal, the files it touched, the commits, and what the person asked
 * for and corrected, with what Kira worked out from them above it — and it is
 * drawn outside the transcript because reading it must not become a turn.
 * Nothing here is sent to a model, and looking costs nothing.
 *
 * It is deliberately not the summary a compaction writes. That says where the
 * work stands; this is everything Kira was told, in the order Kira was told it,
 * and what Kira concluded from it, which is what a person checking Kira's memory
 * needs to see.
 *
 * The pane around it — how wide it is, whether it is showing, the tab that names
 * it — belongs to the workbench, so nothing here draws a panel of its own.
 */
import { Text } from '@astryxdesign/core/Text';
import { borderVars, colorVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import type { ChatConclusion, ChatMemory, MemoryKind } from '../../preload/bridge';
import { conclusionGroupIn, coverageLine, groupsIn, type ConclusionGroup } from './memoryGroups';

const styles = stylex.create({
  tab: {
    display: 'flex',
    flexDirection: 'column',
  },
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    paddingBlockEnd: spacingVars['--spacing-3'],
    marginBlockEnd: spacingVars['--spacing-3'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  groups: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-4'],
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
  },
  /**
   * The heading and how many are under it, which is what makes it skimmable.
   *
   * Laid out here and nowhere else: what a heading looks like is Astryx's, so the
   * two are told apart by weight and colour rather than by this reaching in to
   * restyle its output.
   */
  heading: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacingVars['--spacing-2'],
  },
  items: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1-5'],
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  item: {
    paddingInlineStart: spacingVars['--spacing-2'],
    borderInlineStartWidth: borderVars['--border-width'],
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colorVars['--color-border'],
  },
  /** A file Kira read is context, not work: quieter than the rest. */
  quiet: { borderInlineStartColor: 'transparent' },
  /** A conclusion and how far it had read, stacked rather than run together. */
  concluded: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
  },
});

/** What Kira is holding for `memory`, or nothing while Kira is holding nothing. */
export function ContextTab({
  memory,
  conclusions,
}: {
  memory: readonly ChatMemory[];
  conclusions: readonly ChatConclusion[];
}) {
  const groups = groupsIn(memory);
  const concluded = conclusionGroupIn(conclusions);

  return (
    <div {...stylex.props(styles.tab)}>
      <div {...stylex.props(styles.head)}>
        <Text type="supporting" weight="medium">
          What Kira is holding
        </Text>
        <Text type="supporting" color="secondary">
          Kept outside the conversation, so reading it costs nothing.
        </Text>
      </div>

      {concluded === null && groups.length === 0 ? (
        <Text type="supporting" color="secondary">
          Nothing yet. Kira learns as you work.
        </Text>
      ) : (
        <div {...stylex.props(styles.groups)}>
          {concluded !== null && <Concluded group={concluded} />}
          {groups.map((group) => (
            <Group key={group.kind} label={group.label} items={group.items} kind={group.kind} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What Kira worked out, above what Kira was told.
 *
 * First because the pane reads top-down most important first, and a conclusion
 * is what the things under it amounted to. Each one says how far it had read, so
 * a person can tell a conclusion drawn from the whole chat from one drawn early.
 */
function Concluded({ group }: { group: ConclusionGroup }) {
  return (
    <Section label={group.label} count={group.items.length}>
      {group.items.map((conclusion) => (
        <Conclusion key={conclusion.text} conclusion={conclusion} />
      ))}
    </Section>
  );
}

function Conclusion({ conclusion }: { conclusion: ChatConclusion }) {
  const coverage = coverageLine(conclusion.coversThrough);

  return (
    <li {...stylex.props(styles.item, styles.concluded)}>
      <Text type="supporting" color="primary">
        {conclusion.text}
      </Text>
      {coverage !== null && (
        <Text type="supporting" color="secondary">
          {coverage}
        </Text>
      )}
    </li>
  );
}

/**
 * A heading, how many are under it, and the list itself.
 *
 * The frame both kinds of thing are drawn in, so what a heading looks like and
 * how a list is spaced are decided once. What goes in the list is the caller's:
 * a conclusion carries how far it had read, and nothing Kira was told does.
 */
function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(styles.group)}>
      <div {...stylex.props(styles.heading)}>
        <Text type="supporting" weight="medium" color="secondary">
          {label}
        </Text>
        <Text type="supporting" color="secondary">
          {count}
        </Text>
      </div>
      <ul {...stylex.props(styles.items)}>{children}</ul>
    </section>
  );
}

function Group({
  label,
  kind,
  items,
}: {
  label: string;
  kind: MemoryKind;
  items: readonly ChatMemory[];
}) {
  return (
    <Section label={label} count={items.length}>
      {items.map((item) => (
        <li key={item.text} {...stylex.props(styles.item, kind === 'read' && styles.quiet)}>
          <Text type="supporting" color={kind === 'read' ? 'secondary' : 'primary'}>
            {item.text}
          </Text>
        </li>
      ))}
    </Section>
  );
}
