/**
 * Where a chat was summarised, standing in the transcript.
 *
 * A compaction is not something anybody said, so it is not drawn in a bubble: it
 * is a rule across the column, above the message it hands over to, that opens to
 * the reconstruction Kira kept. Collapsed it is a line to skim past while
 * scrolling — the rule is what makes it findable, the sentence on it what makes
 * it readable — and opening it is how a reader finds out what Kira still knows.
 *
 * What the sentence says is read off the boundary and never out of the summary it
 * carries: see `lastWords` in the compaction extension, which writes the words
 * down at the one moment the turns are still there to read. So nothing here
 * parses prose this app generated in order to say where it was cut.
 */
import { useCollapsible } from '@astryxdesign/core/Collapsible';
import { Icon } from '@astryxdesign/core/Icon';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  durationVars,
  easeVars,
  focusVars,
  spacingVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import { useId, type ReactNode } from 'react';
import * as stylex from '@stylexjs/stylex';
import type { ChatPart } from '../../preload/bridge';
import { relativeTime } from './chatOrdering';
import { summarised } from './compactionText';

/** A boundary, as the transcript hands it over. */
export type Boundary = Extract<ChatPart, { type: 'compaction' }>;

const styles = stylex.create({
  root: { width: '100%' },
  trigger: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    width: '100%',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    textAlign: 'start',
    ':focus-visible': {
      outlineWidth: focusVars['--focus-outline-width'],
      outlineStyle: focusVars['--focus-outline-style'],
      outlineColor: focusVars['--focus-outline-color'],
      outlineOffset: focusVars['--focus-outline-offset'],
    },
  },
  chevron: {
    flexShrink: 0,
    transitionProperty: 'transform',
    transitionDuration: durationVars['--duration-fast'],
    transitionTimingFunction: easeVars['--ease-standard'],
  },
  chevronOpen: { transform: 'rotate(90deg)' },
  /** The words, which take their room before the rule takes the rest of it. */
  words: { flexShrink: 0 },
  /** One hairline between what went and when, the width of it the slack left over. */
  rule: {
    flexGrow: 1,
    minWidth: spacingVars['--spacing-3'],
    height: borderVars['--border-width'],
    backgroundColor: colorVars['--color-border'],
  },
  /** The reconstruction, on a rail that says it is a note about the chat. */
  reconstruction: {
    marginInlineStart: spacingVars['--spacing-1'],
    marginBlockStart: spacingVars['--spacing-2'],
    paddingInlineStart: spacingVars['--spacing-3'],
    borderInlineStartWidth: borderVars['--border-width'],
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colorVars['--color-border'],
    // Markdown reads Astryx's primary-text token for bold and other inline
    // elements, and the reconstruction is a quotation rather than the chat's own
    // voice. Scope it to the secondary token rather than fighting the children.
    '--color-text-primary': colorVars['--color-text-secondary'],
  },
});

/**
 * One boundary: the count, where the cut fell, and when — opening to the whole
 * reconstruction.
 *
 * The count is what went, not what is left: a person reading back wants to know
 * how much of their chat is no longer in the transcript word for word.
 */
export function CompactionBoundary({ part }: { part: Boundary }) {
  const { isOpen, toggle } = useCollapsible({ isCollapsible: { defaultIsOpen: false } });
  const reconstructionId = useId();

  return (
    <div {...stylex.props(styles.root)}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={reconstructionId}
        onClick={toggle}
        {...stylex.props(styles.trigger)}
      >
        <Icon
          icon="chevronRight"
          size="sm"
          color="secondary"
          xstyle={[styles.chevron, isOpen && styles.chevronOpen]}
        />
        <Text type="supporting" weight="medium" color="secondary" xstyle={styles.words}>
          {summarised(part)}
        </Text>
        <span {...stylex.props(styles.rule)} />
        <Text type="supporting" color="secondary">
          {relativeTime(part.at)}
        </Text>
      </button>
      {isOpen && (
        <div {...stylex.props(styles.reconstruction)} id={reconstructionId}>
          <Markdown components={{ heading: SectionHeading }}>{part.reconstruction}</Markdown>
        </div>
      )}
    </div>
  );
}

/**
 * A section of the reconstruction, which is a note about the chat rather than a
 * title in it.
 *
 * The summary is written with `##` headings of its own, and at heading scale they
 * would shout louder than the conversation they describe. Astryx's Markdown
 * renders headings through this, which is where a document's headings are said
 * rather than in a rule that would have to reach into it.
 */
function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <Text type="supporting" weight="medium" color="secondary">
      {children}
    </Text>
  );
}
