/**
 * PROTOTYPE — throwaway. Question: what should a chat with no messages say?
 *
 * Three variants of the empty transcript, switched with the bar at the top of the
 * pane or ←/→, kept in `?variant=` so a reload stays put. Read-only apart from
 * variant B, whose starters only fill the composer; nothing is sent. When one wins,
 * rewrite it as real code in App.tsx and delete this file (see
 * docs/internal/desktop-conventions.md, "A prototype is a switch, not a fork").
 */
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Kbd } from '@astryxdesign/core/Kbd';
import { Text } from '@astryxdesign/core/Text';
import { colorVars, radiusVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import { useAui } from '@assistant-ui/react';
import * as stylex from '@stylexjs/stylex';
import { ChevronLeft, ChevronRight, MessageSquareDashed } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

const VARIANTS = [
  { key: 'A', name: 'Plain empty state' },
  { key: 'B', name: 'With starters' },
  { key: 'C', name: 'Modes and keys' },
] as const;

const STARTERS = [
  'Explain how this project is laid out',
  'Find out why the tests are failing',
  'Review my uncommitted changes',
];

const styles = stylex.create({
  centered: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '45vh',
  },
  starters: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacingVars['--spacing-2'],
  },
  lead: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-4'],
    paddingBlockStart: 56,
  },
  ledger: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    columnGap: spacingVars['--spacing-4'],
    margin: 0,
  },
  ledgerRow: {
    display: 'grid',
    gridColumn: '1 / -1',
    gridTemplateColumns: 'subgrid',
    alignItems: 'baseline',
    paddingBlock: spacingVars['--spacing-2'],
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  ledgerTerm: { margin: 0 },
  ledgerDetail: { margin: 0 },
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
  switcher: {
    position: 'absolute',
    top: spacingVars['--spacing-3'],
    insetInline: 0,
    marginInline: 'auto',
    width: 'fit-content',
    zIndex: 2,
    margin: 0,
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
    paddingInline: spacingVars['--spacing-1'],
    borderRadius: radiusVars['--radius-full'],
    backgroundColor: colorVars['--color-text-primary'],
    color: colorVars['--color-background-surface'],
  },
  switcherLabel: {
    minWidth: 150,
    textAlign: 'center',
    fontSize: 12,
  },
});

function VariantA(): ReactNode {
  return (
    <div {...stylex.props(styles.centered)}>
      <EmptyState
        icon={<Icon icon={MessageSquareDashed} size="lg" />}
        title="Start the chat"
        description="Ask Kira to read, change, or run something in this folder."
        headingLevel={2}
      />
    </div>
  );
}

function VariantB(): ReactNode {
  const aui = useAui();
  return (
    <div {...stylex.props(styles.centered)}>
      <EmptyState
        title="What should Kira work on?"
        description="Write it below, or start from one of these."
        headingLevel={2}
        actions={
          <div {...stylex.props(styles.starters)}>
            {STARTERS.map((starter) => (
              <Button
                key={starter}
                label={starter}
                variant="secondary"
                onClick={() => aui.composer.setText(starter)}
              />
            ))}
          </div>
        }
      />
    </div>
  );
}

function VariantC(): ReactNode {
  return (
    <div {...stylex.props(styles.lead)}>
      <Text type="large" weight="medium">
        Tell Kira what to do in this folder.
      </Text>
      <dl {...stylex.props(styles.ledger)}>
        <div {...stylex.props(styles.ledgerRow)}>
          <dt {...stylex.props(styles.ledgerTerm)}>
            <Text type="label" weight="medium">
              Build
            </Text>
          </dt>
          <dd {...stylex.props(styles.ledgerDetail)}>
            <Text type="supporting">Kira makes the requested changes in your workspace.</Text>
          </dd>
        </div>
        <div {...stylex.props(styles.ledgerRow)}>
          <dt {...stylex.props(styles.ledgerTerm)}>
            <Text type="label" weight="medium">
              Spec
            </Text>
          </dt>
          <dd {...stylex.props(styles.ledgerDetail)}>
            <Text type="supporting">Kira helps shape and plan the work before building it.</Text>
          </dd>
        </div>
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

function readVariant(): number {
  const key = new URLSearchParams(window.location.search).get('variant');
  return Math.max(
    0,
    VARIANTS.findIndex((each) => each.key === key),
  );
}

export function EmptyThreadPrototype(): ReactNode {
  const [index, setIndex] = useState(readVariant);
  const current = VARIANTS[index] ?? VARIANTS[0];

  const move = (step: number): void =>
    setIndex((current) => (current + step + VARIANTS.length) % VARIANTS.length);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('variant', current.key);
    window.history.replaceState(null, '', url);
  }, [current.key]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select') || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') setIndex((c) => (c + VARIANTS.length - 1) % VARIANTS.length);
      if (event.key === 'ArrowRight') setIndex((c) => (c + 1) % VARIANTS.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {index === 0 ? <VariantA /> : null}
      {index === 1 ? <VariantB /> : null}
      {index === 2 ? <VariantC /> : null}
      <fieldset {...stylex.props(styles.switcher)} aria-label="Prototype variant">
        <IconButton
          label="Previous variant"
          icon={<Icon icon={ChevronLeft} size="sm" />}
          size="sm"
          variant="ghost"
          onClick={() => move(-1)}
        />
        <span {...stylex.props(styles.switcherLabel)}>
          {current.key} · {current.name}
        </span>
        <IconButton
          label="Next variant"
          icon={<Icon icon={ChevronRight} size="sm" />}
          size="sm"
          variant="ghost"
          onClick={() => move(1)}
        />
      </fieldset>
    </>
  );
}
