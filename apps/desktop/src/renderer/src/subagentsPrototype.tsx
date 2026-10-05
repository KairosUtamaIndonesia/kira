/**
 * PROTOTYPE: Three variants of the chat's Agents panel — the incumbent selector,
 * a roster/detail split, and a report-first run journal — switchable with
 * `?variant=A|B|C` on the existing chat route.
 *
 * Direction: preserve Kira's warm neutral surfaces and ruled Workbench; use
 * semantic state colors, Kira red only for selection, and the existing compact
 * Inter/mono hierarchy. The variants differ in information structure, not skin.
 */
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import {
  borderVars,
  colorVars,
  radiusVars,
  shadowVars,
  spacingVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import type { ChatMessage, ChatTranscript, SubagentSummary } from '../../preload/bridge';

const VARIANTS = [
  { key: 'A', name: 'Current' },
  { key: 'B', name: 'Roster' },
  { key: 'C', name: 'Run journal' },
] as const;
type Variant = (typeof VARIANTS)[number]['key'];

const styles = stylex.create({
  root: { minWidth: 0, width: '100%', paddingBlockEnd: 56 },
  heading: {
    paddingBlockEnd: spacingVars['--spacing-2'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  count: { fontFamily: 'var(--font-family-code)', fontVariantNumeric: 'tabular-nums' },
  chips: { flexWrap: 'wrap' },
  detail: { minWidth: 0 },
  selectedTitle: { overflowWrap: 'anywhere' },
  roster: {
    maxHeight: 192,
    overflowY: 'auto',
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  rosterButton: {
    width: '100%',
    textAlign: 'start',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    paddingBlock: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-2'],
    border: 0,
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    cursor: 'pointer',
    ':hover': { backgroundColor: colorVars['--color-background-muted'] },
    ':focus-visible': {
      outline: `2px solid ${colorVars['--color-accent']}`,
      outlineOffset: -2,
    },
  },
  rosterButtonSelected: { backgroundColor: colorVars['--color-background-muted'] },
  title: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  status: { whiteSpace: 'nowrap', fontFamily: 'var(--font-family-code)' },
  split: { display: 'grid', gridTemplateColumns: 'minmax(7rem, 0.85fr) minmax(0, 2fr)', minHeight: 0 },
  splitRoster: {
    minWidth: 0,
    borderInlineEndWidth: borderVars['--border-width'],
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: colorVars['--color-border'],
  },
  splitDetail: { minWidth: 0, paddingInlineStart: spacingVars['--spacing-3'] },
  journal: { gap: spacingVars['--spacing-4'] },
  journalRun: {
    minWidth: 0,
    paddingBlockStart: spacingVars['--spacing-3'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  journalSelected: { borderBlockStartColor: colorVars['--color-accent'] },
  result: {
    borderInlineStartWidth: 2,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colorVars['--color-accent'],
    paddingInlineStart: spacingVars['--spacing-3'],
  },
  switcher: {
    position: 'fixed',
    zIndex: 1000,
    right: 60,
    bottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    padding: spacingVars['--spacing-1'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border-emphasized'],
    borderRadius: radiusVars['--radius-full'],
    backgroundColor: colorVars['--color-background-popover'],
    boxShadow: shadowVars['--shadow-med'],
    '@media (max-width: 70rem)': { display: 'none' },
  },
  switcherLabel: { minWidth: 104, textAlign: 'center' },
});

export function SubagentsPrototype({
  agents,
  selectedId,
  transcript,
  onSelect,
  isVisible,
}: {
  agents: SubagentSummary[];
  selectedId: string | null;
  transcript: ChatTranscript | null;
  onSelect: (id: string | null) => void;
  isVisible: boolean;
}) {
  const [variant, setVariant] = useState<Variant>(() => variantFromUrl());
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents.at(-1) ?? null;

  function cycle(direction: number) {
    setVariant((current) => {
      const index = VARIANTS.findIndex((item) => item.key === current);
      const next = VARIANTS[(index + direction + VARIANTS.length) % VARIANTS.length]!;
      const url = new URL(window.location.href);
      url.searchParams.set('variant', next.key);
      window.history.replaceState(window.history.state, '', url);
      return next.key;
    });
  }

  useMountEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const switcher = document.querySelector('[data-subagents-prototype-switcher="visible"]');
      if (
        switcher === null ||
        switcher.getClientRects().length === 0 ||
        (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
      ) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
      ) {
        return;
      }
      event.preventDefault();
      cycle(event.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!import.meta.env.DEV) {
    return <AgentsPanel agents={agents} selected={selected} transcript={transcript} onSelect={onSelect} />;
  }

  return (
    <div {...stylex.props(styles.root)}>
      {variant === 'A' ? (
        <CurrentVariant agents={agents} selected={selected} transcript={transcript} onSelect={onSelect} />
      ) : variant === 'B' ? (
        <RosterVariant agents={agents} selected={selected} transcript={transcript} onSelect={onSelect} />
      ) : (
        <JournalVariant
          agents={agents}
          selectedId={selected?.id ?? null}
          transcript={transcript}
          onSelect={onSelect}
        />
      )}
      {isVisible && agents.length > 0 ? (
        <nav
          aria-label="UI prototype variants"
          data-subagents-prototype-switcher="visible"
          {...stylex.props(styles.switcher)}
        >
          <IconButton
            label="Previous variant"
            size="sm"
            variant="ghost"
            onClick={() => cycle(-1)}
            icon={<Icon icon={ChevronLeft} size="sm" />}
          />
          <Text size="sm" {...stylex.props(styles.switcherLabel)}>
            {variant} · {VARIANTS.find((item) => item.key === variant)?.name}
          </Text>
          <IconButton
            label="Next variant"
            size="sm"
            variant="ghost"
            onClick={() => cycle(1)}
            icon={<Icon icon={ChevronRight} size="sm" />}
          />
        </nav>
      ) : null}
    </div>
  );
}

function CurrentVariant({
  agents,
  selected,
  transcript,
  onSelect,
}: {
  agents: SubagentSummary[];
  selected: SubagentSummary | null;
  transcript: ChatTranscript | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <VStack gap={3}>
      <HStack gap={2} {...stylex.props(styles.chips)}>
        {agents.map((agent) => (
          <Button
            key={agent.id}
            label={agent.title}
            size="sm"
            variant={selected?.id === agent.id ? 'primary' : 'ghost'}
            onClick={() => onSelect(agent.id)}
          />
        ))}
      </HStack>
      {selected ? <AgentDetail selected={selected} transcript={transcript} /> : null}
    </VStack>
  );
}

function RosterVariant({
  agents,
  selected,
  transcript,
  onSelect,
}: {
  agents: SubagentSummary[];
  selected: SubagentSummary | null;
  transcript: ChatTranscript | null;
  onSelect: (id: string | null) => void;
}) {
  const running = agents.filter((agent) => agent.state === 'running').length;
  return (
    <VStack gap={3}>
      <HStack justify="between" align="center" {...stylex.props(styles.heading)}>
        <Text type="label">Delegated work</Text>
        <Text size="sm" color="secondary" {...stylex.props(styles.count)}>
          {String(agents.length).padStart(2, '0')} · {running} running
        </Text>
      </HStack>
      <div {...stylex.props(styles.split)}>
        <div aria-label="Subagent runs" {...stylex.props(styles.splitRoster)}>
          <div {...stylex.props(styles.roster)}>
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                aria-pressed={selected?.id === agent.id}
                aria-label={`${agent.title}, ${agent.state}`}
                {...stylex.props(
                  styles.rosterButton,
                  selected?.id === agent.id && styles.rosterButtonSelected,
                )}
                onClick={() => onSelect(agent.id)}
              >
                <span {...stylex.props(styles.title)}>{agent.title}</span>
                <span {...stylex.props(styles.status)}>{stateWord(agent)}</span>
              </button>
            ))}
          </div>
        </div>
        <div {...stylex.props(styles.splitDetail)}>
          {selected ? <AgentDetail selected={selected} transcript={transcript} /> : null}
        </div>
      </div>
    </VStack>
  );
}

function JournalVariant({
  agents,
  selectedId,
  transcript,
  onSelect,
}: {
  agents: SubagentSummary[];
  selectedId: string | null;
  transcript: ChatTranscript | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <VStack gap={3} {...stylex.props(styles.journal)}>
      <HStack justify="between" align="center" {...stylex.props(styles.heading)}>
        <Text type="label">Run journal</Text>
        <Text size="sm" color="secondary" {...stylex.props(styles.count)}>
          {String(agents.length).padStart(2, '0')} runs
        </Text>
      </HStack>
      {agents.map((agent) => (
        <section
          key={agent.id}
          {...stylex.props(styles.journalRun, selectedId === agent.id && styles.journalSelected)}
        >
          <button
            type="button"
            aria-pressed={selectedId === agent.id}
            {...stylex.props(styles.rosterButton)}
            onClick={() => onSelect(agent.id)}
          >
            <span {...stylex.props(styles.title)}>{agent.title}</span>
            <span {...stylex.props(styles.status)}>{stateWord(agent)}</span>
          </button>
          <HStack gap={2}>
            <Text size="sm" color="secondary">{agent.role}</Text>
            {agent.activity ? <Text size="sm" color="secondary">{agent.activity}</Text> : null}
          </HStack>
          {agent.error ? <Text color="secondary">{agent.error}</Text> : null}
          {agent.outcome ? (
            <div {...stylex.props(styles.result)}>
              <Text>{agent.outcome}</Text>
            </div>
          ) : null}
          {selectedId === agent.id ? <Transcript messages={transcript?.messages ?? []} /> : null}
        </section>
      ))}
    </VStack>
  );
}

function AgentDetail({
  selected,
  transcript,
}: {
  selected: SubagentSummary;
  transcript: ChatTranscript | null;
}) {
  return (
    <VStack gap={2} {...stylex.props(styles.detail)}>
      <HStack justify="between" align="center">
        <Text type="label" {...stylex.props(styles.selectedTitle)}>{selected.title}</Text>
        <Text size="sm" color="secondary" {...stylex.props(styles.status)}>{stateWord(selected)}</Text>
      </HStack>
      <Text size="sm" color="secondary">
        {selected.role}{selected.activity ? ` · ${selected.activity}` : ''}
      </Text>
      {selected.error ? <Text color="secondary">{selected.error}</Text> : null}
      {selected.outcome ? <div {...stylex.props(styles.result)}><Text>{selected.outcome}</Text></div> : null}
      <Transcript messages={transcript?.messages ?? []} />
    </VStack>
  );
}

function Transcript({ messages }: { messages: ChatMessage[] }) {
  return (
    <VStack gap={3}>
      {messages.map((message) => <TranscriptMessage key={message.id} message={message} />)}
    </VStack>
  );
}

function TranscriptMessage({ message }: { message: ChatMessage }) {
  return (
    <VStack gap={1}>
      <Text size="sm" color="secondary">{message.role === 'you' ? 'Task' : 'Agent'}</Text>
      {message.parts.map((part, index) => {
        if (part.type === 'text') return <Text key={index}>{part.text}</Text>;
        if (part.type === 'work') {
          return (
            <VStack key={index} gap={1}>
              {part.reasoning ? <Text color="secondary">{part.reasoning}</Text> : null}
              {part.calls.map((call, callIndex) => (
                <VStack key={`${call.name}-${callIndex}`} gap={0.5}>
                  <Text size="sm" color="secondary">{call.name}{call.target ? ` · ${call.target}` : ''}</Text>
                  {call.output ? <Text>{call.output}</Text> : null}
                </VStack>
              ))}
            </VStack>
          );
        }
        if (part.type === 'compaction') return <Text key={index}>{part.reconstruction}</Text>;
        return null;
      })}
    </VStack>
  );
}

function AgentsPanel({
  agents,
  selected,
  transcript,
  onSelect,
}: {
  agents: SubagentSummary[];
  selected: SubagentSummary | null;
  transcript: ChatTranscript | null;
  onSelect: (id: string | null) => void;
}) {
  return <CurrentVariant agents={agents} selected={selected} transcript={transcript} onSelect={onSelect} />;
}

function stateWord(agent: SubagentSummary): string {
  if (agent.state === 'running') return agent.activity ?? 'Working';
  if (agent.state === 'complete') return 'Done';
  if (agent.state === 'stopped') return 'Stopped';
  return 'Error';
}

function variantFromUrl(): Variant {
  const key = new URLSearchParams(window.location.search).get('variant');
  return VARIANTS.find((variant) => variant.key === key)?.key ?? 'A';
}

function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}
