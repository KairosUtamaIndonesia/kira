/**
 * PROTOTYPE: Three structures for the chat's Agents panel, switchable with
 * `?variant=A|B|C` on the existing chat route.
 *
 * What every variant shares, and what the first pass got wrong: a run is read
 * as a report, not a log. The task is the title; the report is the content; the
 * work is the chat's own `Work` step, folded; the raw task prompt is a
 * disclosure. State is a dot with a word, never a `· complete · Done` string.
 * Kira red appears only on the selected run.
 *
 * A · Stack    one ruled list of runs, the selected run's report beneath.
 * B · Cards    each run a card with its report excerpt; the open one unfolds.
 * C · Focus    a numbered strip of runs over one full-width report.
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Badge } from '@astryxdesign/core/Badge';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { HStack } from '@astryxdesign/core/HStack';
import { Button } from '@astryxdesign/core/Button';
import { ChatComposer } from '@astryxdesign/core/Chat';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Markdown } from '@astryxdesign/core/Markdown';
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
import { useEffect, useState, type ReactNode } from 'react';
import * as stylex from '@stylexjs/stylex';
import type {
  ChatMessage,
  ChatTranscript,
  ModelOption,
  SubagentControl,
  SubagentSummary,
} from '../../preload/bridge';
import { AGENT_STATE_WORD, AgentStateMark } from './agentState';
import { modelName } from './replyMeta';
import { Work } from './workTrace';

const VARIANTS = [
  { key: 'A', name: 'Stack' },
  { key: 'B', name: 'Cards' },
  { key: 'C', name: 'Focus' },
] as const;
type Variant = (typeof VARIANTS)[number]['key'];

const ROLE = { general: 'General', explore: 'Explore' } as const;

const styles = stylex.create({
  root: { minWidth: 0, width: '100%', paddingBlockEnd: 56 },
  list: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-background-surface'],
    overflow: 'hidden',
  },
  row: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: '8px minmax(0, 1fr) auto',
    alignItems: 'center',
    columnGap: spacingVars['--spacing-3'],
    width: '100%',
    paddingBlock: spacingVars['--spacing-3'],
    paddingInline: spacingVars['--spacing-3'],
    border: 0,
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    textAlign: 'start',
    cursor: 'pointer',
    ':first-child': { borderBlockStartWidth: 0 },
    ':hover': { backgroundColor: colorVars['--color-background-muted'] },
    ':focus-visible': {
      outline: `2px solid ${colorVars['--color-accent']}`,
      outlineOffset: -2,
    },
  },
  rowOn: { backgroundColor: colorVars['--color-background-muted'] },
  bar: {
    position: 'absolute',
    insetBlock: 0,
    insetInlineStart: 0,
    width: 2,
    backgroundColor: colorVars['--color-accent'],
  },
  stateWord: { whiteSpace: 'nowrap' },
  card: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-background-surface'],
    overflow: 'hidden',
  },
  cardOn: { borderColor: colorVars['--color-border-emphasized'], boxShadow: shadowVars['--shadow-low'] },
  cardHead: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacingVars['--spacing-1-5'],
    width: '100%',
    padding: spacingVars['--spacing-3'],
    border: 0,
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    textAlign: 'start',
    cursor: 'pointer',
    ':hover': { backgroundColor: colorVars['--color-background-muted'] },
    ':focus-visible': {
      outline: `2px solid ${colorVars['--color-accent']}`,
      outlineOffset: -2,
    },
  },
  cardBody: {
    paddingInline: spacingVars['--spacing-3'],
    paddingBlockEnd: spacingVars['--spacing-3'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
    paddingBlockStart: spacingVars['--spacing-3'],
  },
  strip: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-1-5'],
    margin: 0,
    padding: 0,
    border: 0,
    minWidth: 0,
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    minWidth: 0,
    maxWidth: 'min(26ch, 100%)',
    gap: spacingVars['--spacing-1-5'],
    paddingBlock: spacingVars['--spacing-1'],
    paddingInline: spacingVars['--spacing-3'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-full'],
    backgroundColor: 'transparent',
    color: colorVars['--color-text-secondary'],
    cursor: 'pointer',
    ':hover': { backgroundColor: colorVars['--color-background-muted'] },
    ':focus-visible': { outline: `2px solid ${colorVars['--color-accent']}`, outlineOffset: 2 },
  },
  pillOn: {
    borderColor: colorVars['--color-accent'],
    backgroundColor: colorVars['--color-background-muted'],
    color: colorVars['--color-text-primary'],
  },
  detail: { minWidth: 0 },
  controls: {
    position: 'sticky',
    insetBlockEnd: 0,
    zIndex: 1,
    paddingBlock: spacingVars['--spacing-3'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
    backgroundColor: colorVars['--color-background-surface'],
  },
  label: { textTransform: 'uppercase', letterSpacing: '0.06em' },
  report: {
    minWidth: 0,
    padding: spacingVars['--spacing-3'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: colorVars['--color-background-surface'],
    overflowWrap: 'anywhere',
  },
  reportInCard: { backgroundColor: colorVars['--color-background-muted'], borderWidth: 0 },
  activity: { minWidth: 0, overflowWrap: 'anywhere' },
  task: { overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
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
  switcherLabel: { minWidth: 88, textAlign: 'center' },
});

interface PanelProps {
  agents: SubagentSummary[];
  selected: SubagentSummary | null;
  transcript: ChatTranscript | null;
  onSelect: (id: string | null) => void;
  onControl: (childId: string, control: SubagentControl) => Promise<string | null>;
  models: readonly ModelOption[];
}

export function SubagentsPrototype({
  agents,
  selectedId,
  transcript,
  onSelect,
  onControl,
  models,
  isVisible,
}: {
  agents: SubagentSummary[];
  selectedId: string | null;
  transcript: ChatTranscript | null;
  onSelect: (id: string | null) => void;
  onControl: (childId: string, control: SubagentControl) => Promise<string | null>;
  models: readonly ModelOption[];
  isVisible: boolean;
}) {
  const [variant, setVariant] = useState<Variant>(() => variantFromUrl());
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents.at(-1) ?? null;
  const panel = { agents, selected, transcript, onSelect, onControl, models };

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

  if (!import.meta.env.DEV) return <StackVariant {...panel} />;

  return (
    <div {...stylex.props(styles.root)}>
      {variant === 'A' ? (
        <StackVariant {...panel} />
      ) : variant === 'B' ? (
        <CardsVariant {...panel} />
      ) : (
        <FocusVariant {...panel} />
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

/** A · one ruled list; the selected run's report sits under it. */
function StackVariant({
  agents,
  selected,
  transcript,
  onSelect,
  onControl,
  models,
}: PanelProps) {
  return (
    <VStack gap={5}>
      <div {...stylex.props(styles.list)}>
        {agents.map((agent) => {
          const on = selected?.id === agent.id;
          return (
            <button
              key={agent.id}
              type="button"
              aria-pressed={on}
              {...stylex.props(styles.row, on && styles.rowOn)}
              onClick={() => onSelect(agent.id)}
            >
              {on ? <span aria-hidden="true" {...stylex.props(styles.bar)} /> : null}
              <Dot agent={agent} />
              <Text maxLines={1} weight={on ? 'semibold' : 'normal'}>
                {agent.title}
              </Text>
              <Text size="sm" color="secondary" xstyle={styles.stateWord}>
                {AGENT_STATE_WORD[agent.state]}
              </Text>
            </button>
          );
        })}
      </div>
      {selected ? <RunDetail agent={selected} transcript={transcript} onControl={onControl} models={models} /> : null}
    </VStack>
  );
}

/** B · every run a card with its report excerpt; the open one unfolds in place. */
function CardsVariant({
  agents,
  selected,
  transcript,
  onSelect,
  onControl,
  models,
}: PanelProps) {
  return (
    <VStack gap={3}>
      {agents.map((agent) => {
        const on = selected?.id === agent.id;
        const excerpt = agent.error ?? plain(agent.outcome);
        return (
          <section key={agent.id} {...stylex.props(styles.card, on && styles.cardOn)}>
            <button
              type="button"
              aria-expanded={on}
              {...stylex.props(styles.cardHead)}
              onClick={() => onSelect(agent.id)}
            >
              {on ? <span aria-hidden="true" {...stylex.props(styles.bar)} /> : null}
              <HStack justify="between" align="center" gap={2}>
                <HStack gap={2} align="center">
                  <Dot agent={agent} />
                  <Text size="sm" color="secondary">
                    {AGENT_STATE_WORD[agent.state]} · {ROLE[agent.role]} ·{' '}
                    {modelName(models, agent.modelId)}
                  </Text>
                </HStack>
              </HStack>
              <Text weight="semibold" maxLines={on ? 0 : 2}>
                {agent.title}
              </Text>
              {!on && excerpt ? (
                <Text size="sm" color="secondary" maxLines={3}>
                  {excerpt}
                </Text>
              ) : null}
            </button>
            {on ? (
              <div {...stylex.props(styles.cardBody)}>
                <RunDetail agent={agent} transcript={transcript} onControl={onControl} models={models} inCard />
              </div>
            ) : null}
          </section>
        );
      })}
    </VStack>
  );
}

/** C · a numbered strip of runs over one full-width report. */
function FocusVariant({
  agents,
  selected,
  transcript,
  onSelect,
  onControl,
  models,
}: PanelProps) {
  return (
    <VStack gap={4}>
      <fieldset aria-label="Subagent runs" {...stylex.props(styles.strip)}>
        {agents.map((agent) => {
          const on = selected?.id === agent.id;
          return (
            <button
              key={agent.id}
              type="button"
              aria-pressed={on}
              aria-label={`${agent.title}, ${AGENT_STATE_WORD[agent.state]}`}
              {...stylex.props(styles.pill, on && styles.pillOn)}
              onClick={() => onSelect(agent.id)}
            >
              <Dot agent={agent} />
              <Text size="sm" weight="medium" color="inherit" maxLines={1}>
                {agent.title}
              </Text>
            </button>
          );
        })}
      </fieldset>
      {selected ? <RunDetail agent={selected} transcript={transcript} onControl={onControl} models={models} large /> : null}
    </VStack>
  );
}

/** The one place a run is read: report first, work folded, task on request. */
function RunDetail({
  agent,
  transcript,
  onControl,
  models,
  inCard = false,
  large = false,
}: {
  agent: SubagentSummary;
  transcript: ChatTranscript | null;
  onControl: (childId: string, control: SubagentControl) => Promise<string | null>;
  models: readonly ModelOption[];
  inCard?: boolean;
  large?: boolean;
}) {
  const messages = transcript?.messages ?? [];
  const task = messages.find((message) => message.role === 'you');
  const taskText = task ? textOf(task) : agent.title;
  const steps = messages
    .filter((message) => message.role !== 'you')
    .flatMap((message) => message.parts)
    .filter((part) => part.type === 'work' || (part.type === 'text' && part.text.trim() !== agent.outcome?.trim()));
  const working = agent.state === 'running';

  return (
    <VStack gap={4} xstyle={styles.detail}>
      {inCard ? null : (
        <VStack gap={1.5}>
          <Text type={large ? 'large' : 'body'} weight="semibold" textWrap="balance">
            {agent.title}
          </Text>
          <HStack gap={2} align="center">
            <Dot agent={agent} />
            <Text size="sm" color="secondary">
              {AGENT_STATE_WORD[agent.state]}
              {working && agent.activity ? ` · ${agent.activity}` : ''}
            </Text>
            <Badge label={ROLE[agent.role]} variant="neutral" />
            <Text size="sm" color="secondary">
              {modelName(models, agent.modelId)}
            </Text>
          </HStack>
        </VStack>
      )}
      {inCard && working && agent.activity ? (
        <Text size="sm" color="secondary">
          {agent.activity}
        </Text>
      ) : null}
      {agent.error ? <Banner status="error" title={agent.error} /> : null}
      {agent.outcome ? (
        <Section label="Report">
          <div {...stylex.props(styles.report, inCard && styles.reportInCard)}>
            <Markdown density="compact">{agent.outcome}</Markdown>
          </div>
        </Section>
      ) : null}
      {steps.length > 0 ? (
        <Section label="Activity">
          <VStack gap={2} xstyle={styles.activity}>
            {steps.map((part, index) =>
              part.type === 'work' ? (
                <Work
                  key={index}
                  part={part}
                  isWorking={working && index === steps.length - 1}
                  isLive={working}
                />
              ) : part.type === 'text' ? (
                <Markdown key={index} density="compact">{part.text}</Markdown>
              ) : null,
            )}
          </VStack>
        </Section>
      ) : null}
      <Collapsible
        defaultIsOpen={false}
        chevronPosition="start"
        trigger={
          <Text size="sm" weight="medium" color="secondary">
            Task given
          </Text>
        }
      >
        <Text size="sm" color="secondary" xstyle={styles.task}>
          {taskText}
        </Text>
      </Collapsible>
      {agent.controllable ? (
        <AgentControls key={agent.id} agent={agent} onControl={onControl} />
      ) : null}
    </VStack>
  );
}

/**
 * What a person can do to a run: redirect or stop one that is working, or hand a
 * finished or stopped one more to do. It is the same input either way; what
 * sending means follows from the run's state.
 */
function AgentControls({
  agent,
  onControl,
}: {
  agent: SubagentSummary;
  onControl: (childId: string, control: SubagentControl) => Promise<string | null>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const running = agent.state === 'running';

  async function take(control: SubagentControl) {
    setBusy(true);
    setRefusal(null);
    const error = await onControl(agent.id, control);
    setBusy(false);
    if (error !== null) setRefusal(error);
    else if (control.action !== 'stop') setText('');
  }

  function send(value: string) {
    const words = value.trim();
    if (words === '' || busy) return;
    void take({ action: running ? 'steer' : 'resume', text: words });
  }

  return (
    <div {...stylex.props(styles.controls)}>
      <ChatComposer
        value={text}
        onChange={setText}
        onSubmit={send}
        placeholder={running ? 'Steer this agent…' : 'Give it more to do…'}
        density="compact"
        isDisabled={busy}
        status={refusal === null ? undefined : { type: 'error', message: refusal }}
        sendActions={
          running ? (
            <Button
              label="Stop"
              size="sm"
              variant="ghost"
              isDisabled={busy}
              onClick={() => void take({ action: 'stop' })}
            />
          ) : undefined
        }
      />
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <VStack gap={1.5}>
      <Text size="xsm" weight="semibold" color="secondary" xstyle={styles.label}>
        {label}
      </Text>
      {children}
    </VStack>
  );
}

function Dot({ agent }: { agent: SubagentSummary }) {
  return <AgentStateMark state={agent.state} />;
}

function textOf(message: ChatMessage): string {
  return message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim();
}

/** A report as one line of prose, for an excerpt: no markup, no breaks. */
function plain(markdown: string | null): string | null {
  if (markdown === null) return null;
  return markdown.replace(/[*`#>]/g, '').replace(/\s+/g, ' ').trim();
}

function variantFromUrl(): Variant {
  const key = new URLSearchParams(window.location.search).get('variant');
  return VARIANTS.find((variant) => variant.key === key)?.key ?? 'A';
}

function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}
