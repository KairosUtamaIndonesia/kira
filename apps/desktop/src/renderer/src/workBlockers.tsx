/**
 * A ticket's blockers — what it waits on and what waits on it — as ledger rows. A blocker
 * is filled in from the ticket it names (title, lane, who is working on it), and the
 * section says what the blockers mean for the ticket right now.
 */
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
import {
  colorVars,
  focusVars,
  radiusVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleAlert, Lock, LockOpen, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { NamedTicket, Ticket, TicketStatus } from '../../preload/bridge.ts';
import { copy } from './workCopy.ts';
import { statusIcon, statusOf } from './workRows.ts';

interface Props {
  ticket: Ticket;
  tickets: Ticket[];
  onOpen: (id: string) => void;
  /** Name a ticket that has to close first; null when the server refused. */
  onGate: (blockerId: string) => Promise<Ticket | null>;
  onUngate: (blockerId: string) => Promise<Ticket | null>;
}

/** A named ticket, filled in from the queue when the queue holds it. */
interface Link {
  named: NamedTicket;
  full: Ticket | undefined;
}

function links(named: NamedTicket[], tickets: Ticket[]): Link[] {
  return named.map((each) => ({ named: each, full: tickets.find((t) => t.id === each.id) }));
}

function stateWords(link: Link): string {
  const status = link.full === undefined ? link.named.status : statusOf(link.full);
  return copy.statusWord[status];
}

type Tone = TicketStatus | 'blocked';

function tone(link: Link): Tone {
  return link.full === undefined ? link.named.status : statusOf(link.full);
}

function isClosed(status: TicketStatus): boolean {
  return status === 'done' || status === 'wont-do';
}

/** The one sentence that says what the blockers mean for this ticket right now. */
function verdict(
  ticket: Ticket,
  blockers: Link[],
): { tone: 'clear' | 'waiting' | 'check'; words: string } {
  const open = blockers.filter((each) => !isClosed(each.named.status));
  const dropped = blockers.filter((each) => each.named.status === 'wont-do');
  if (blockers.length === 0) return { tone: 'clear', words: copy.blockers.none };
  if (open.length > 0) {
    return {
      tone: 'waiting',
      words:
        open.length === 1
          ? copy.blockers.waitingOne(open[0]!.named.name, ticket.name)
          : copy.blockers.waitingMany(open.length, blockers.length, ticket.name),
    };
  }
  // Closed is not the same as done: a blocker closed as won't do means the work this
  // ticket was waiting for is not coming, which a person should see before starting.
  if (dropped.length > 0) {
    return {
      tone: 'check',
      words: copy.blockers.wontDo(
        dropped.map((each) => each.named.name).join(', '),
        dropped.length > 1,
        ticket.name,
      ),
    };
  }
  return {
    tone: 'clear',
    words:
      blockers.length === 1
        ? copy.blockers.allDoneOne(ticket.name)
        : copy.blockers.allDoneMany(blockers.length, ticket.name),
  };
}

/** Whether this ticket is the last thing holding a downstream ticket up. */
function lastHold(ticket: Ticket, link: Link): boolean {
  const others =
    link.full?.children.filter((each) => each.id !== ticket.id && !isClosed(each.status)) ?? [];
  return !isClosed(link.named.status) && others.length === 0 && !isClosed(ticket.status);
}

function AddBlocker({ ticket, tickets, onGate }: Props) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const taken = new Set([ticket.id, ...ticket.children.map((each) => each.id)]);
  const candidates = tickets.filter((each) => !isClosed(each.status) && !taken.has(each.id));
  const [chosen, setChosen] = useState('');

  if (!adding) {
    return (
      <span {...stylex.props(ui.addRow)}>
        <Button
          label={copy.blockers.add}
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
          label={copy.blockers.pick}
          isLabelHidden
          isDisabled={busy}
          placeholder={copy.blockers.pickPlaceholder}
          options={candidates.map((each) => ({
            value: each.id,
            label: `${each.name} · ${each.title || copy.untitled}`,
          }))}
          value={chosen}
          onChange={setChosen}
        />
      </div>
      <Button
        label={copy.blockers.confirm}
        size="sm"
        variant="primary"
        isDisabled={chosen === '' || busy}
        onClick={() => {
          setBusy(true);
          void onGate(chosen).then((held) => {
            setBusy(false);
            if (held === null) return;
            setChosen('');
            setAdding(false);
          });
        }}
      />
      <Button
        label={copy.blockers.cancel}
        size="sm"
        variant="ghost"
        isDisabled={busy}
        onClick={() => setAdding(false)}
      />
    </div>
  );
}

function StateMark({ link }: { link: Link }) {
  const t = tone(link);
  const icon = statusIcon(t);
  return (
    <span {...stylex.props(ui.mark, toneText[t])}>
      <Icon icon={icon} size="sm" />
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * One linked ticket, in four columns that line up down the list: its state icon, its name,
 * its title, and where it stands. Removing it takes the place of where it stands on hover,
 * so the row reserves no room for a button most rows never show.
 */
function Row({
  link,
  onOpen,
  hint,
  onRemove,
}: {
  link: Link;
  onOpen: (id: string) => void;
  hint?: string;
  onRemove?: () => void;
}) {
  const person = link.full?.assignee?.name;
  return (
    <li {...stylex.props(ui.row, onRemove !== undefined && ui.rowRemovable)}>
      <button
        type="button"
        aria-label={copy.blockers.open(link.named.name, link.full?.title ?? null)}
        {...stylex.props(ui.rowOpen)}
        onClick={() => onOpen(link.named.id)}
      />
      <StateMark link={link} />
      <span {...stylex.props(ui.id)}>{link.named.name}</span>
      <span {...stylex.props(ui.title, isClosed(link.named.status) && ui.titleClosed)}>
        {link.full?.title ?? copy.blockers.titleUnavailable}
      </span>
      <span {...stylex.props(ui.meta)}>
        {hint !== undefined && <span {...stylex.props(ui.hint)}>{hint}</span>}
        {person !== undefined && (
          <span {...stylex.props(ui.person)} title={person}>
            {initials(person)}
          </span>
        )}
        <span {...stylex.props(ui.state, toneText[tone(link)])}>{stateWords(link)}</span>
      </span>
      {onRemove !== undefined && (
        <span {...stylex.props(ui.remove)}>
          <IconButton
            label={copy.blockers.remove(link.named.name)}
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

export function Blockers(props: Props) {
  const { ticket, tickets, onOpen, onUngate } = props;
  const blockers = links(ticket.children, tickets);
  const blocking = links(ticket.gates, tickets);
  const said = verdict(ticket, blockers);
  const closed = blockers.filter((each) => isClosed(each.named.status)).length;

  return (
    <section {...stylex.props(ui.section)} aria-label={copy.blockers.aria}>
      <header {...stylex.props(ui.head)}>
        <h3 {...stylex.props(ui.heading)}>{copy.blockers.blockedBy}</h3>
        {blockers.length > 0 && (
          <span
            {...stylex.props(ui.progress)}
            aria-label={copy.blockers.progressAria(closed, blockers.length)}
          >
            <span {...stylex.props(ui.bar)}>
              <span
                {...stylex.props(ui.barFill, said.tone === 'check' && ui.barFillCheck)}
                style={{ width: `${(closed / blockers.length) * 100}%` }}
              />
            </span>
            {copy.blockers.progress(closed, blockers.length)}
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
              onRemove={() => void onUngate(each.named.id)}
            />
          ))}
        </ul>
      )}
      <AddBlocker {...props} />

      <header {...stylex.props(ui.head, ui.headGap)}>
        <h3 {...stylex.props(ui.heading)}>{copy.blockers.blocking}</h3>
        <span {...stylex.props(ui.count)}>{copy.blockers.blockingCount(blocking.length)}</span>
      </header>
      {blocking.length === 0 ? (
        <p {...stylex.props(ui.muted)}>{copy.blockers.nothingWaits(ticket.name)}</p>
      ) : (
        <ul {...stylex.props(ui.list)}>
          {blocking.map((each) => (
            <Row
              key={each.named.id}
              link={each}
              onOpen={onOpen}
              hint={lastHold(ticket, each) ? copy.blockers.lastBlocker : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const toneText = stylex.create({
  done: { color: colorVars['--color-text-green'] },
  'wont-do': { color: colorVars['--color-text-orange'] },
  draft: { color: colorVars['--color-text-secondary'] },
  ready: { color: colorVars['--color-text-secondary'] },
  running: { color: colorVars['--color-text-blue'] },
  'needs-review': { color: colorVars['--color-text-yellow'] },
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
    fontWeight: 500,
    color: colorVars['--color-text-primary'],
  },
  count: {
    fontSize: textSizeVars['--font-size-sm'],
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
  barFillCheck: { backgroundColor: colorVars['--color-warning'] },
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
  // One grid for the whole list, so every row's name column is as wide as the longest name
  // and the titles start on one line down the list.
  list: {
    display: 'grid',
    gridTemplateColumns: '16px max-content minmax(0, 1fr) auto',
    columnGap: spacingVars['--spacing-3'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  // Ruled like the finish line's checks above it: same divider, same padding, same text.
  row: {
    '--row-reveal': { default: '0', ':hover': '1', ':focus-within': '1' },
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: 'subgrid',
    gridColumn: '1 / -1',
    alignItems: 'center',
    paddingBlock: spacingVars['--spacing-2'],
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-background-muted'],
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
  },
  rowRemovable: { '--removable': '1' },
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
    fontVariantNumeric: 'tabular-nums',
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
  titleClosed: { color: colorVars['--color-text-secondary'] },
  meta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacingVars['--spacing-2'],
    minWidth: 96,
    opacity: 'calc(1 - var(--row-reveal) * var(--removable, 0))',
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
  },
  hint: {
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    whiteSpace: 'nowrap',
  },
  person: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    borderRadius: 999,
    fontSize: textSizeVars['--font-size-xs'],
    fontWeight: 600,
    color: colorVars['--color-text-primary'],
    backgroundColor: colorVars['--color-neutral'],
  },
  state: {
    minWidth: 76,
    textAlign: 'end',
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  remove: {
    position: 'absolute',
    insetBlock: 0,
    insetInlineEnd: spacingVars['--spacing-1'],
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
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
});

const VERDICT_STYLE = {
  clear: ui.verdictClear,
  waiting: ui.verdictWaiting,
  check: ui.verdictCheck,
} as const;
