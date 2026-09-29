/**
 * PROTOTYPE — throwaway. Three ways to draw a ticket's blockers — what it waits on and what
 * waits on it — switchable from a development-only bar.
 *
 * Question it answers: what does a person need from this section to decide what to do
 * next? Each variant fills a blocker in from the ticket it names (title, lane, kind, who is
 * working on it), not just its name, and says what the ticket's own state means for the
 * tickets downstream. Opening a blocker is real; adding and removing are stubs.
 * Once a variant wins, rewrite it properly in `work.tsx` and drop this file from main.
 */
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
import {
  colorVars,
  focusVars,
  radiusVars,
  shadowVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowDown, CircleAlert, CircleCheck, Lock, LockOpen, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { Band, NamedTicket, Ticket } from '../../preload/bridge.ts';
import { bandIcon } from './workRows.ts';

const VARIANTS = [
  { id: 'ledger', label: 'Ledger rows' },
  { id: 'flow', label: 'Flow' },
  { id: 'split', label: 'Side by side' },
] as const;
type Variant = (typeof VARIANTS)[number]['id'];

interface Props {
  ticket: Ticket;
  tickets: Ticket[];
  onOpen: (id: string) => void;
}

/** A named ticket, filled in from the queue when the queue holds it. */
interface Link {
  named: NamedTicket;
  full: Ticket | undefined;
}

function links(named: NamedTicket[], tickets: Ticket[]): Link[] {
  return named.map((each) => ({ named: each, full: tickets.find((t) => t.id === each.id) }));
}

const STATE_WORDS: Record<Band, string> = {
  'needs-you': 'Needs review',
  ready: 'Ready',
  running: 'Running',
  blocked: 'Blocked',
  draft: 'Draft',
  done: 'Done',
};

function stateWords(link: Link): string {
  if (link.named.closed) return link.named.closure === 'wontfix' ? 'Won’t do' : 'Done';
  return link.full === undefined ? 'Open' : STATE_WORDS[link.full.band];
}

type Tone = 'done' | 'wontfix' | 'open' | 'running' | 'review' | 'blocked';

function tone(link: Link): Tone {
  if (link.named.closed) return link.named.closure === 'wontfix' ? 'wontfix' : 'done';
  const band: Band | undefined = link.full?.band;
  if (band === 'running') return 'running';
  if (band === 'needs-you') return 'review';
  if (band === 'blocked') return 'blocked';
  return 'open';
}

export function BlockersPrototype(props: Props) {
  const [variant, setVariant] = useState<Variant>('ledger');
  const [note, setNote] = useState<string | null>(null);
  const stub = (action: string): void => setNote(`“${action}” is stubbed in the prototype.`);
  const shared = { ...props, onStub: stub };

  return (
    <>
      {variant === 'ledger' && <LedgerBlockers {...shared} />}
      {variant === 'flow' && <FlowBlockers {...shared} />}
      {variant === 'split' && <SplitBlockers {...shared} />}
      <div {...stylex.props(ui.switcher)} role="toolbar" aria-label="Blocker prototypes">
        {VARIANTS.map((each, index) => (
          <button
            key={each.id}
            type="button"
            aria-pressed={each.id === variant}
            {...stylex.props(ui.segment, each.id === variant && ui.segmentOn)}
            onClick={() => {
              setVariant(each.id);
              setNote(null);
            }}
          >
            {String.fromCharCode(65 + index)} · {each.label}
          </button>
        ))}
        {note !== null && <span {...stylex.props(ui.note)}>{note}</span>}
      </div>
    </>
  );
}

type Shared = Props & { onStub: (action: string) => void };

/** The one sentence that says what the blockers mean for this ticket right now. */
function verdict(
  ticket: Ticket,
  blockers: Link[],
): { tone: 'clear' | 'waiting' | 'check'; words: string } {
  const open = blockers.filter((each) => !each.named.closed);
  const dropped = blockers.filter((each) => each.named.closure === 'wontfix');
  if (blockers.length === 0) return { tone: 'clear', words: 'Nothing blocks it.' };
  if (open.length > 0) {
    return {
      tone: 'waiting',
      words:
        open.length === 1
          ? `Waiting on ${open[0]!.named.name}. ${ticket.name} can start once it closes.`
          : `Waiting on ${open.length} of ${blockers.length} blockers. ${ticket.name} can start once they close.`,
    };
  }
  // Closed is not the same as done: a blocker closed as won't do means the work this
  // ticket was waiting for is not coming, which a person should see before starting.
  if (dropped.length > 0) {
    return {
      tone: 'check',
      words: `${dropped.map((each) => each.named.name).join(', ')} ${dropped.length === 1 ? 'was' : 'were'} closed as won’t do. Check ${ticket.name} still makes sense before starting it.`,
    };
  }
  return {
    tone: 'clear',
    words:
      blockers.length === 1
        ? `Its blocker is done, so ${ticket.name} can start.`
        : `All ${blockers.length} blockers are done, so ${ticket.name} can start.`,
  };
}

/** Whether this ticket is the last thing holding a downstream ticket up. */
function lastHold(ticket: Ticket, link: Link): boolean {
  const others = link.full?.children.filter((each) => each.id !== ticket.id && !each.closed) ?? [];
  return !link.named.closed && others.length === 0 && ticket.closedAt === null;
}

function AddBlocker({ ticket, tickets, onStub }: Shared) {
  const [adding, setAdding] = useState(false);
  const taken = new Set([ticket.id, ...ticket.children.map((each) => each.id)]);
  const candidates = tickets.filter((each) => each.closedAt === null && !taken.has(each.id));
  const [chosen, setChosen] = useState('');

  if (!adding) {
    return (
      <span {...stylex.props(ui.addRow)}>
        <Button
          label="Add blocker"
          icon={<Icon icon={Plus} size="sm" />}
          size="sm"
          variant="ghost"
          onClick={() => setAdding(true)}
        />
      </span>
    );
  }
  return (
    <div {...stylex.props(ui.adding)}>
      <div {...stylex.props(ui.grow)}>
        <Selector
          label="Blocker"
          isLabelHidden
          placeholder="Choose a ticket that has to close first"
          options={candidates.map((each) => ({
            value: each.id,
            label: `${each.name} · ${each.title || 'Untitled'}`,
          }))}
          value={chosen}
          onChange={setChosen}
        />
      </div>
      <Button
        label="Add"
        size="sm"
        variant="primary"
        isDisabled={chosen === ''}
        onClick={() => onStub('Add blocker')}
      />
      <Button label="Cancel" size="sm" variant="ghost" onClick={() => setAdding(false)} />
    </div>
  );
}

function StateMark({ link }: { link: Link }) {
  const t = tone(link);
  const icon =
    t === 'done'
      ? CircleCheck
      : t === 'wontfix'
        ? CircleAlert
        : link.full !== undefined
          ? bandIcon(link.full)
          : CircleAlert;
  return (
    <span {...stylex.props(ui.mark, toneText[t])}>
      <Icon icon={icon} size="sm" />
    </span>
  );
}

function Row({
  link,
  onOpen,
  aside,
  onRemove,
}: {
  link: Link;
  onOpen: (id: string) => void;
  aside?: string;
  onRemove?: () => void;
}) {
  const person = link.full?.claim?.holder.name;
  return (
    <li {...stylex.props(ui.row, link.named.closed && ui.rowClosed)}>
      <button
        type="button"
        aria-label={`Open ${link.named.name}: ${link.full?.title ?? ''}`}
        {...stylex.props(ui.rowOpen)}
        onClick={() => onOpen(link.named.id)}
      />
      <StateMark link={link} />
      <span {...stylex.props(ui.id)}>{link.named.name}</span>
      <span {...stylex.props(ui.title, link.named.closed && ui.titleClosed)}>
        {link.full?.title ?? 'A ticket outside this view'}
      </span>
      {aside !== undefined && <span {...stylex.props(ui.aside)}>{aside}</span>}
      <span {...stylex.props(ui.state, toneText[tone(link)])}>
        {person !== undefined && !link.named.closed ? `${person} · ` : ''}
        {stateWords(link)}
      </span>
      {onRemove !== undefined && (
        <span {...stylex.props(ui.remove)}>
          <IconButton
            label={`Remove ${link.named.name} as a blocker`}
            icon={<Icon icon={X} size="sm" />}
            variant="ghost"
            size="sm"
            onClick={onRemove}
          />
        </span>
      )}
    </li>
  );
}

/* ── A. Ledger rows ─────────────────────────────────────────────────────── */

function LedgerBlockers(props: Shared) {
  const { ticket, tickets, onOpen, onStub } = props;
  const blockers = links(ticket.children, tickets);
  const blocking = links(ticket.gates, tickets);
  const said = verdict(ticket, blockers);
  const closed = blockers.filter((each) => each.named.closed).length;

  return (
    <section {...stylex.props(ui.section)} aria-label="Blockers">
      <header {...stylex.props(ui.head)}>
        <h3 {...stylex.props(ui.heading)}>Blocked by</h3>
        {blockers.length > 0 && (
          <span
            {...stylex.props(ui.progress)}
            aria-label={`${closed} of ${blockers.length} closed`}
          >
            <span {...stylex.props(ui.bar)}>
              <span
                {...stylex.props(ui.barFill)}
                style={{ width: `${(closed / blockers.length) * 100}%` }}
              />
            </span>
            {closed}/{blockers.length} closed
          </span>
        )}
      </header>
      <p {...stylex.props(ui.verdict, VERDICT_STYLE[said.tone])}>
        <Icon
          icon={said.tone === 'clear' ? LockOpen : said.tone === 'check' ? CircleAlert : Lock}
          size="sm"
        />
        {said.words}
      </p>
      {blockers.length > 0 && (
        <ul {...stylex.props(ui.list)}>
          {blockers.map((each) => (
            <Row
              key={each.named.id}
              link={each}
              onOpen={onOpen}
              onRemove={() => onStub('Remove blocker')}
            />
          ))}
        </ul>
      )}
      <AddBlocker {...props} />

      <header {...stylex.props(ui.head, ui.headGap)}>
        <h3 {...stylex.props(ui.heading)}>Blocking</h3>
        <span {...stylex.props(ui.count)}>{blocking.length}</span>
      </header>
      {blocking.length === 0 ? (
        <p {...stylex.props(ui.muted)}>No other ticket waits on {ticket.name}.</p>
      ) : (
        <ul {...stylex.props(ui.list)}>
          {blocking.map((each) => (
            <Row
              key={each.named.id}
              link={each}
              onOpen={onOpen}
              aside={lastHold(ticket, each) ? 'waits only on this' : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── B. Flow ────────────────────────────────────────────────────────────── */

function FlowBlockers(props: Shared) {
  const { ticket, tickets, onOpen, onStub } = props;
  const blockers = links(ticket.children, tickets);
  const blocking = links(ticket.gates, tickets);
  const said = verdict(ticket, blockers);

  return (
    <section {...stylex.props(ui.section)} aria-label="Blockers">
      <h3 {...stylex.props(ui.heading)}>Blockers</h3>
      <div {...stylex.props(flow.stack)}>
        <div {...stylex.props(flow.group)}>
          <span {...stylex.props(flow.caption)}>Has to close first</span>
          {blockers.length === 0 ? (
            <p {...stylex.props(ui.muted)}>Nothing blocks it.</p>
          ) : (
            <ul {...stylex.props(ui.list)}>
              {blockers.map((each) => (
                <Row
                  key={each.named.id}
                  link={each}
                  onOpen={onOpen}
                  onRemove={() => onStub('Remove blocker')}
                />
              ))}
            </ul>
          )}
          <AddBlocker {...props} />
        </div>
        <span {...stylex.props(flow.arrow)} aria-hidden>
          <Icon icon={ArrowDown} size="sm" />
        </span>
        <div
          {...stylex.props(flow.self, said.tone === 'clear' ? flow.selfClear : flow.selfWaiting)}
        >
          <Icon
            icon={said.tone === 'clear' ? LockOpen : said.tone === 'check' ? CircleAlert : Lock}
            size="sm"
          />
          <span {...stylex.props(ui.id)}>{ticket.name}</span>
          <span {...stylex.props(flow.selfWords)}>{said.words}</span>
        </div>
        <span {...stylex.props(flow.arrow)} aria-hidden>
          <Icon icon={ArrowDown} size="sm" />
        </span>
        <div {...stylex.props(flow.group)}>
          <span {...stylex.props(flow.caption)}>Waiting on {ticket.name}</span>
          {blocking.length === 0 ? (
            <p {...stylex.props(ui.muted)}>Nothing waits on it.</p>
          ) : (
            <ul {...stylex.props(ui.list)}>
              {blocking.map((each) => (
                <Row
                  key={each.named.id}
                  link={each}
                  onOpen={onOpen}
                  aside={lastHold(ticket, each) ? 'waits only on this' : undefined}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── C. Side by side ────────────────────────────────────────────────────── */

function SplitBlockers(props: Shared) {
  const { ticket, tickets, onOpen, onStub } = props;
  const blockers = links(ticket.children, tickets);
  const blocking = links(ticket.gates, tickets);
  const said = verdict(ticket, blockers);

  return (
    <section {...stylex.props(ui.section)} aria-label="Blockers">
      <h3 {...stylex.props(ui.heading)}>Blockers</h3>
      <p {...stylex.props(ui.verdict, VERDICT_STYLE[said.tone])}>
        <Icon
          icon={said.tone === 'clear' ? LockOpen : said.tone === 'check' ? CircleAlert : Lock}
          size="sm"
        />
        {said.words}
      </p>
      <div {...stylex.props(split.grid)}>
        <div {...stylex.props(split.card)}>
          <span {...stylex.props(split.cardHead)}>
            Blocked by <span {...stylex.props(ui.count)}>{blockers.length}</span>
          </span>
          {blockers.length === 0 ? (
            <p {...stylex.props(ui.muted)}>Nothing.</p>
          ) : (
            <ul {...stylex.props(ui.list)}>
              {blockers.map((each) => (
                <Row
                  key={each.named.id}
                  link={each}
                  onOpen={onOpen}
                  onRemove={() => onStub('Remove blocker')}
                />
              ))}
            </ul>
          )}
          <AddBlocker {...props} />
        </div>
        <div {...stylex.props(split.card)}>
          <span {...stylex.props(split.cardHead)}>
            Blocking <span {...stylex.props(ui.count)}>{blocking.length}</span>
          </span>
          {blocking.length === 0 ? (
            <p {...stylex.props(ui.muted)}>Nothing.</p>
          ) : (
            <ul {...stylex.props(ui.list)}>
              {blocking.map((each) => (
                <Row
                  key={each.named.id}
                  link={each}
                  onOpen={onOpen}
                  aside={lastHold(ticket, each) ? 'only this' : undefined}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const toneText = stylex.create({
  done: { color: colorVars['--color-text-green'] },
  wontfix: { color: colorVars['--color-text-orange'] },
  open: { color: colorVars['--color-text-secondary'] },
  running: { color: colorVars['--color-text-blue'] },
  review: { color: colorVars['--color-text-yellow'] },
  blocked: { color: colorVars['--color-text-orange'] },
});

const ui = stylex.create({
  section: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headGap: { marginBlockStart: spacingVars['--spacing-4'] },
  heading: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacingVars['--spacing-2'],
    margin: 0,
    fontSize: textSizeVars['--font-size-base'],
    fontWeight: 600,
  },
  count: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 400,
    color: colorVars['--color-text-secondary'],
  },
  progress: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  bar: {
    display: 'inline-block',
    width: 64,
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: colorVars['--color-background-muted'],
  },
  barFill: { display: 'block', height: '100%', backgroundColor: colorVars['--color-success'] },
  verdict: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    margin: 0,
    paddingBlock: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-3'],
    borderRadius: radiusVars['--radius-container'],
    fontSize: textSizeVars['--font-size-sm'],
  },
  verdictWaiting: {
    color: colorVars['--color-text-orange'],
    backgroundColor: colorVars['--color-warning-muted'],
  },
  verdictCheck: {
    color: colorVars['--color-text-orange'],
    backgroundColor: colorVars['--color-warning-muted'],
  },
  verdictClear: {
    color: colorVars['--color-text-green'],
    backgroundColor: colorVars['--color-success-muted'],
  },
  list: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' },
  row: {
    '--row-reveal': { default: '0', ':hover': '1', ':focus-within': '1' },
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: 'auto auto minmax(0, 1fr) auto auto auto',
    alignItems: 'center',
    columnGap: spacingVars['--spacing-2'],
    minHeight: 36,
    paddingInline: spacingVars['--spacing-2'],
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
  },
  rowClosed: {},
  rowOpen: {
    position: 'absolute',
    inset: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: -2,
  },
  mark: { display: 'inline-flex' },
  id: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    whiteSpace: 'nowrap',
  },
  title: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: textSizeVars['--font-size-base'],
    color: colorVars['--color-text-primary'],
  },
  titleClosed: {
    color: colorVars['--color-text-secondary'],
    textDecorationLine: 'line-through',
    textDecorationColor: colorVars['--color-border-emphasized'],
  },
  aside: {
    paddingInline: 6,
    borderRadius: 999,
    fontSize: textSizeVars['--font-size-xs'],
    lineHeight: '18px',
    whiteSpace: 'nowrap',
    color: colorVars['--color-text-accent'],
    backgroundColor: colorVars['--color-accent-muted'],
  },
  state: { fontSize: textSizeVars['--font-size-sm'], whiteSpace: 'nowrap' },
  remove: {
    position: 'relative',
    zIndex: 1,
    display: 'inline-flex',
    opacity: 'var(--row-reveal)',
  },
  muted: {
    margin: 0,
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  addRow: { display: 'flex', marginInlineStart: `calc(-1 * ${spacingVars['--spacing-3']})` },
  adding: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-2'] },
  grow: { flex: 1, minWidth: 0 },
  switcher: {
    position: 'fixed',
    insetBlockEnd: 16,
    insetInlineStart: '50%',
    transform: 'translateX(-50%)',
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: spacingVars['--spacing-1'],
    borderRadius: 999,
    backgroundColor: colorVars['--color-background-inverted'],
    color: colorVars['--color-background-surface'],
    boxShadow: shadowVars['--shadow-high'],
    fontSize: textSizeVars['--font-size-sm'],
  },
  segment: {
    height: 24,
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: { default: 'transparent', ':hover': 'rgb(128 128 128 / 0.25)' },
    color: 'inherit',
    fontSize: textSizeVars['--font-size-sm'],
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  segmentOn: {
    backgroundColor: {
      default: colorVars['--color-accent'],
      ':hover': colorVars['--color-accent'],
    },
    color: colorVars['--color-on-accent'],
  },
  note: { paddingInline: spacingVars['--spacing-2'], opacity: 0.8, whiteSpace: 'nowrap' },
});

const VERDICT_STYLE = {
  clear: ui.verdictClear,
  waiting: ui.verdictWaiting,
  check: ui.verdictCheck,
} as const;

const flow = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  group: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-1'] },
  caption: {
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 600,
    color: colorVars['--color-text-secondary'],
  },
  arrow: {
    display: 'flex',
    justifyContent: 'center',
    width: 32,
    color: colorVars['--color-icon-secondary'],
  },
  self: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    paddingBlock: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-3'],
    borderRadius: radiusVars['--radius-container'],
    borderWidth: 1,
    borderStyle: 'solid',
  },
  selfWaiting: {
    color: colorVars['--color-text-orange'],
    borderColor: colorVars['--color-warning'],
    backgroundColor: colorVars['--color-warning-muted'],
  },
  selfClear: {
    color: colorVars['--color-text-green'],
    borderColor: colorVars['--color-success'],
    backgroundColor: colorVars['--color-success-muted'],
  },
  selfWords: { fontSize: textSizeVars['--font-size-sm'] },
});

const split = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: spacingVars['--spacing-3'],
    '@media (max-width: 900px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    minWidth: 0,
    padding: spacingVars['--spacing-3'],
    borderRadius: 10,
    backgroundColor: colorVars['--color-background-muted'],
  },
  cardHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacingVars['--spacing-2'],
    paddingBlockEnd: spacingVars['--spacing-1'],
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 600,
  },
});
