/**
 * PROTOTYPE — throwaway. Three layouts for a ticket's full view, reached from the board's
 * drawer through an Expand button that only development builds draw.
 *
 * Question it answers: once the drawer grows into a page, how should a ticket be laid
 * out? Every variant reads the ticket the drawer was showing — or, with "Rich sample" on,
 * an in-memory ticket with runs, gates and a workspace so every section has something in
 * it. Nothing here writes: actions are stubs that say so. Collapse returns to the drawer.
 * Once a layout wins, rewrite it properly in `work.tsx` and drop this file from main.
 */
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import {
  colorVars,
  focusVars,
  shadowVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Copy,
  FolderGit2,
  History,
  MessageSquare,
  Minimize2,
  Play,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type {
  Band,
  ChatSummary,
  ExecutionWorkspace,
  NamedTicket,
  Ticket,
} from '../../preload/bridge.ts';
import { holding, runTelling, when } from './workRows.ts';

/* ── Variants and the switcher ──────────────────────────────────────────── */

export const TICKET_VARIANTS = [
  { id: 'rail', label: 'Document + rail' },
  { id: 'float', label: 'Document + floating box' },
  { id: 'ledger', label: 'Ledger page' },
  { id: 'tabs', label: 'Tabbed workbench' },
] as const;

export type TicketVariant = (typeof TICKET_VARIANTS)[number]['id'];

export function readTicketVariant(): TicketVariant {
  const said = new URLSearchParams(window.location.search).get('ticketView');
  return TICKET_VARIANTS.find((each) => each.id === said)?.id ?? 'rail';
}

export function TicketPrototypeSwitcher({
  variant,
  onChange,
  rich,
  onToggleRich,
  note,
}: {
  variant: TicketVariant;
  onChange: (next: TicketVariant) => void;
  rich: boolean;
  onToggleRich: () => void;
  note: string | null;
}) {
  const pick = (next: TicketVariant): void => {
    const params = new URLSearchParams(window.location.search);
    params.set('ticketView', next);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    onChange(next);
  };

  return (
    <div {...stylex.props(ui.switcher)} role="toolbar" aria-label="Ticket view prototypes">
      <fieldset aria-label="Layout" {...stylex.props(ui.segments)}>
        {TICKET_VARIANTS.map((each, index) => (
          <button
            key={each.id}
            type="button"
            aria-pressed={each.id === variant}
            {...stylex.props(ui.segment, each.id === variant && ui.segmentOn)}
            onClick={() => pick(each.id)}
          >
            {String.fromCharCode(65 + index)} · {each.label}
          </button>
        ))}
      </fieldset>
      <button
        type="button"
        aria-pressed={rich}
        {...stylex.props(ui.toggle, rich && ui.toggleOn)}
        onClick={onToggleRich}
      >
        Rich sample
      </button>
      {note !== null && <span {...stylex.props(ui.note)}>{note}</span>}
    </div>
  );
}

/* ── What every variant reads ───────────────────────────────────────────── */

export interface TicketViewProps {
  ticket: Ticket;
  laneLabel: (band: Band) => string;
  workspaces: ExecutionWorkspace[];
  chats: ChatSummary[];
  onCollapse: () => void;
  onClose: () => void;
  onStub: (action: string) => void;
}

export function TicketFullPrototype(props: TicketViewProps & { variant: TicketVariant }) {
  if (props.variant === 'ledger') return <LedgerPage {...props} />;
  if (props.variant === 'tabs') return <TabbedPage {...props} />;
  if (props.variant === 'float') return <RailPage {...props} floating />;
  return <RailPage {...props} />;
}

/** The actions a person has on this ticket, in the order the real drawer offers them. */
function actionsFor(ticket: Ticket): { label: string; primary: boolean }[] {
  const said: { label: string; primary: boolean }[] = [];
  if (ticket.closedAt !== null) return [{ label: 'Reopen', primary: false }];
  if (ticket.band === 'ready' && ticket.gate === 'ready-for-agent') {
    said.push({ label: 'Start agent', primary: true });
  }
  if (ticket.band === 'needs-you') {
    said.push({ label: 'Accept result', primary: true }, { label: 'Send back', primary: false });
  }
  if (ticket.gate === 'draft') {
    said.push({ label: 'Mark ready for an agent', primary: true });
  } else {
    said.push({ label: 'Return to draft', primary: false });
  }
  said.push({ label: 'Edit', primary: false }, { label: 'Close it', primary: false });
  return said;
}

function gateWords(ticket: Ticket): string {
  if (ticket.gate === 'draft') return 'Draft';
  return ticket.gate === 'ready-for-agent' ? 'Ready for an agent' : 'Ready for a person';
}

function facts(ticket: Ticket, laneLabel: (band: Band) => string) {
  return [
    { label: 'Status', value: laneLabel(ticket.band) },
    { label: 'Gate', value: gateWords(ticket) },
    { label: 'Kind', value: ticket.kind },
    { label: 'Held by', value: ticket.claim?.holder.name ?? 'Nobody' },
    { label: 'Written by', value: ticket.author?.name ?? '—' },
    { label: 'Rank', value: String(ticket.rank) },
    { label: 'Written', value: when(ticket.createdAt) },
    { label: 'Changed', value: when(ticket.updatedAt) },
  ];
}

/* ── Sections every layout draws, in its own frame ─────────────────────── */

function About({ ticket }: { ticket: Ticket }) {
  return ticket.body.trim() === '' ? (
    <p {...stylex.props(ui.muted)}>No description has been added yet.</p>
  ) : (
    <p {...stylex.props(ui.prose)}>{ticket.body}</p>
  );
}

function DoneWhen({ ticket }: { ticket: Ticket }) {
  if (ticket.criteria.length === 0) {
    return (
      <p {...stylex.props(ui.muted)}>
        No finish line has been written yet. Add one before marking this ready for an agent.
      </p>
    );
  }
  return (
    <ul {...stylex.props(ui.list)}>
      {ticket.criteria.map((line, at) => (
        <li key={`${at}-${line}`} {...stylex.props(ui.listRow)}>
          <span {...stylex.props(ui.listIcon)}>
            <Icon icon={CircleDashed} size="sm" />
          </span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

function Runs({ ticket }: { ticket: Ticket }) {
  if (ticket.runs.length === 0) {
    return <p {...stylex.props(ui.muted)}>No runs yet. Starting an agent adds the first.</p>;
  }
  return (
    <ol {...stylex.props(ui.list)}>
      {ticket.runs.map((run, index) => (
        <li key={run.id} {...stylex.props(ui.run)}>
          <span {...stylex.props(ui.runHead)}>
            <Icon icon={History} size="xsm" />
            <span {...stylex.props(ui.mono)}>Run {ticket.runs.length - index}</span>
            <span {...stylex.props(ui.secondary)}>{runTelling(run)}</span>
          </span>
          {run.changed !== null && <span>{run.changed}</span>}
          {run.checks !== null && run.checks.length > 0 && (
            <span {...stylex.props(ui.checks)}>
              {run.checks.map((check) => (
                <span key={check} {...stylex.props(ui.check)}>
                  <Icon icon={CircleCheck} size="xsm" />
                  {check}
                </span>
              ))}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Named({ tickets, empty }: { tickets: NamedTicket[]; empty: string }) {
  if (tickets.length === 0) return <p {...stylex.props(ui.muted)}>{empty}</p>;
  return (
    <ul {...stylex.props(ui.list)}>
      {tickets.map((each) => {
        const icon: LucideIcon = !each.closed
          ? Play
          : each.closure === 'wontfix'
            ? CircleAlert
            : CircleCheck;
        return (
          <li key={each.id} {...stylex.props(ui.listRow)}>
            <span {...stylex.props(ui.listIcon)}>
              <Icon icon={icon} size="sm" />
            </span>
            <span {...stylex.props(ui.mono)}>{each.name}</span>
            <span {...stylex.props(ui.secondary)}>{each.closed ? 'closed' : 'open'}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Workspaces({
  ticket,
  workspaces,
  onStub,
}: {
  ticket: Ticket;
  workspaces: ExecutionWorkspace[];
  onStub: (action: string) => void;
}) {
  return (
    <div {...stylex.props(ui.stack)}>
      <span {...stylex.props(ui.branch)}>
        <span {...stylex.props(ui.mono, ui.wrap)}>{ticket.branch}</span>
        <IconButton
          label={`Copy ${ticket.branch}`}
          icon={<Icon icon={Copy} size="sm" />}
          size="sm"
          onClick={() => onStub('Copy branch')}
        />
      </span>
      {workspaces.length === 0 ? (
        <p {...stylex.props(ui.muted)}>No execution workspace yet.</p>
      ) : (
        workspaces.map((each) => (
          <span key={each.id} {...stylex.props(ui.listRow)}>
            <span {...stylex.props(ui.listIcon)}>
              <Icon icon={FolderGit2} size="sm" />
            </span>
            <span {...stylex.props(ui.stackTight)}>
              <span {...stylex.props(ui.mono, ui.wrap)}>{each.branch}</span>
              <span {...stylex.props(ui.secondary)}>
                {each.repository} · from {each.baseBranch}
              </span>
            </span>
          </span>
        ))
      )}
    </div>
  );
}

function Chats({ chats, onStub }: { chats: ChatSummary[]; onStub: (action: string) => void }) {
  if (chats.length === 0) return <p {...stylex.props(ui.muted)}>No chats are linked.</p>;
  return (
    <ul {...stylex.props(ui.list)}>
      {chats.map((chat) => (
        <li key={chat.id}>
          <button type="button" {...stylex.props(ui.linkRow)} onClick={() => onStub('Open chat')}>
            <Icon icon={MessageSquare} size="xsm" />
            <span {...stylex.props(ui.ellipsis)}>{chat.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function StateLine({ ticket }: { ticket: Ticket }) {
  const said = holding(ticket);
  return (
    <span {...stylex.props(ui.state)}>
      <Icon icon={said.icon} size="xsm" />
      {said.words}
    </span>
  );
}

function Actions({
  ticket,
  onStub,
  vertical = false,
}: {
  ticket: Ticket;
  onStub: (action: string) => void;
  vertical?: boolean;
}) {
  return (
    <div {...stylex.props(ui.actions, vertical && ui.actionsVertical)}>
      {actionsFor(ticket).map((each) => (
        <Button
          key={each.label}
          label={each.label}
          size="sm"
          variant={each.primary ? 'primary' : each.label === 'Close it' ? 'ghost' : 'secondary'}
          width={vertical ? '100%' : undefined}
          onClick={() => onStub(each.label)}
        />
      ))}
    </div>
  );
}

/** The bar every layout opens with: where you are, and the two ways back out. */
function PageBar({
  ticket,
  laneLabel,
  onCollapse,
  onClose,
  children,
}: {
  ticket: Ticket;
  laneLabel: (band: Band) => string;
  onCollapse: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div {...stylex.props(ui.bar)}>
      <span {...stylex.props(ui.crumbs)}>
        <span>{laneLabel(ticket.band)}</span>
        <span aria-hidden>/</span>
        <span {...stylex.props(ui.mono)}>{ticket.name}</span>
      </span>
      {children}
      <span {...stylex.props(ui.barTools)}>
        <IconButton
          label="Collapse to the drawer"
          icon={<Icon icon={Minimize2} size="sm" />}
          onClick={onCollapse}
        />
        <IconButton label="Close issue" icon={<Icon icon={X} size="sm" />} onClick={onClose} />
      </span>
    </div>
  );
}

/* ── A. Document + rail ─────────────────────────────────────────────────── */

function RailPage({
  ticket,
  laneLabel,
  workspaces,
  chats,
  onCollapse,
  onClose,
  onStub,
  floating = false,
}: TicketViewProps & { floating?: boolean }) {
  return (
    <div {...stylex.props(ui.page)}>
      <PageBar ticket={ticket} laneLabel={laneLabel} onCollapse={onCollapse} onClose={onClose} />
      <div {...stylex.props(rail.grid, floating && float.scroll)}>
        <div {...stylex.props(floating && float.grid)}>
          <article {...stylex.props(rail.doc, floating && float.doc)}>
            <header {...stylex.props(rail.header)}>
              <StateLine ticket={ticket} />
              <h1 {...stylex.props(ui.title)}>{ticket.title || 'Untitled'}</h1>
            </header>
            <Section title="About">
              <About ticket={ticket} />
            </Section>
            <Section title="Done when" count={ticket.criteria.length}>
              <DoneWhen ticket={ticket} />
            </Section>
            <Section title="Runs" count={ticket.runs.length}>
              <Runs ticket={ticket} />
            </Section>
            <Section title="What gates it" count={ticket.children.length}>
              <Named tickets={ticket.children} empty="Nothing gates this." />
            </Section>
            {ticket.gates.length > 0 && (
              <Section title="What it gates" count={ticket.gates.length}>
                <Named tickets={ticket.gates} empty="" />
              </Section>
            )}
          </article>
          <aside {...stylex.props(rail.rail, floating && float.box)} aria-label="Ticket properties">
            <Actions ticket={ticket} onStub={onStub} vertical />
            <dl {...stylex.props(rail.props)}>
              {facts(ticket, laneLabel).map((fact) => (
                <div key={fact.label} {...stylex.props(rail.prop)}>
                  <dt {...stylex.props(ui.secondary)}>{fact.label}</dt>
                  <dd {...stylex.props(rail.propValue)}>{fact.value}</dd>
                </div>
              ))}
            </dl>
            <RailGroup title="Branch and workspace">
              <Workspaces ticket={ticket} workspaces={workspaces} onStub={onStub} />
            </RailGroup>
            <RailGroup title="Linked chats">
              <Chats chats={chats} onStub={onStub} />
            </RailGroup>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(ui.section)}>
      <h2 {...stylex.props(ui.sectionHead)}>
        {title}
        {count !== undefined && <span {...stylex.props(ui.count)}>{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function RailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section {...stylex.props(rail.group)}>
      <h2 {...stylex.props(rail.groupHead)}>{title}</h2>
      {children}
    </section>
  );
}

/* ── B. Ledger page ─────────────────────────────────────────────────────── */

function LedgerPage({
  ticket,
  laneLabel,
  workspaces,
  chats,
  onCollapse,
  onClose,
  onStub,
}: TicketViewProps) {
  return (
    <div {...stylex.props(ui.page)}>
      <PageBar ticket={ticket} laneLabel={laneLabel} onCollapse={onCollapse} onClose={onClose} />
      <div {...stylex.props(ledger.scroll)}>
        <article {...stylex.props(ledger.column)}>
          <header {...stylex.props(ledger.header)}>
            <h1 {...stylex.props(ui.title, ledger.title)}>{ticket.title || 'Untitled'}</h1>
            <StateLine ticket={ticket} />
          </header>
          <dl {...stylex.props(ledger.facts)}>
            {facts(ticket, laneLabel).map((fact) => (
              <div key={fact.label} {...stylex.props(ledger.fact)}>
                <dt {...stylex.props(ui.secondary)}>{fact.label}</dt>
                <dd {...stylex.props(ledger.factValue)}>{fact.value}</dd>
              </div>
            ))}
          </dl>
          <LedgerSection title="About">
            <About ticket={ticket} />
          </LedgerSection>
          <LedgerSection title="Done when" count={ticket.criteria.length}>
            <DoneWhen ticket={ticket} />
          </LedgerSection>
          <LedgerSection title="Runs" count={ticket.runs.length}>
            <Runs ticket={ticket} />
          </LedgerSection>
          <div {...stylex.props(ledger.pair)}>
            <LedgerSection title="What gates it" count={ticket.children.length}>
              <Named tickets={ticket.children} empty="Nothing gates this." />
            </LedgerSection>
            <LedgerSection title="What it gates" count={ticket.gates.length}>
              <Named tickets={ticket.gates} empty="Nothing waits on this." />
            </LedgerSection>
          </div>
          <div {...stylex.props(ledger.pair)}>
            <LedgerSection title="Branch and workspace">
              <Workspaces ticket={ticket} workspaces={workspaces} onStub={onStub} />
            </LedgerSection>
            <LedgerSection title="Linked chats" count={chats.length}>
              <Chats chats={chats} onStub={onStub} />
            </LedgerSection>
          </div>
        </article>
      </div>
      <div {...stylex.props(ledger.foot)}>
        <div {...stylex.props(ledger.footInner)}>
          <Actions ticket={ticket} onStub={onStub} />
        </div>
      </div>
    </div>
  );
}

function LedgerSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(ledger.section)}>
      <h2 {...stylex.props(ledger.sectionHead)}>
        <span>{title}</span>
        {count !== undefined && (
          <span {...stylex.props(ui.count)}>{String(count).padStart(2, '0')}</span>
        )}
      </h2>
      {children}
    </section>
  );
}

/* ── C. Tabbed workbench ────────────────────────────────────────────────── */

const TABS = ['Overview', 'Runs', 'Dependencies', 'Workspace', 'Chats'] as const;
type Tab = (typeof TABS)[number];

function TabbedPage({
  ticket,
  laneLabel,
  workspaces,
  chats,
  onCollapse,
  onClose,
  onStub,
}: TicketViewProps) {
  const [tab, setTab] = useState<Tab>('Overview');
  const counts: Record<Tab, number | null> = {
    Overview: null,
    Runs: ticket.runs.length,
    Dependencies: ticket.children.length + ticket.gates.length,
    Workspace: workspaces.length,
    Chats: chats.length,
  };

  return (
    <div {...stylex.props(ui.page)}>
      <PageBar ticket={ticket} laneLabel={laneLabel} onCollapse={onCollapse} onClose={onClose} />
      <header {...stylex.props(tabs.header)}>
        <div {...stylex.props(tabs.headerCopy)}>
          <h1 {...stylex.props(ui.title)}>{ticket.title || 'Untitled'}</h1>
          <span {...stylex.props(tabs.meta)}>
            <StateLine ticket={ticket} />
            <span {...stylex.props(ui.secondary)}>·</span>
            <span {...stylex.props(ui.secondary)}>{gateWords(ticket)}</span>
            <span {...stylex.props(ui.secondary)}>·</span>
            <span {...stylex.props(ui.secondary)}>{ticket.kind}</span>
          </span>
        </div>
        <Actions ticket={ticket} onStub={onStub} />
      </header>
      <div role="tablist" aria-label="Ticket sections" {...stylex.props(tabs.strip)}>
        {TABS.map((each) => (
          <button
            key={each}
            type="button"
            role="tab"
            aria-selected={each === tab}
            {...stylex.props(tabs.tab, each === tab && tabs.tabOn)}
            onClick={() => setTab(each)}
          >
            {each}
            {counts[each] !== null && <span {...stylex.props(ui.count)}>{counts[each]}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab} {...stylex.props(tabs.panel)}>
        <div {...stylex.props(tabs.panelInner)}>
          {tab === 'Overview' && (
            <>
              <Section title="About">
                <About ticket={ticket} />
              </Section>
              <Section title="Done when" count={ticket.criteria.length}>
                <DoneWhen ticket={ticket} />
              </Section>
            </>
          )}
          {tab === 'Runs' && <Runs ticket={ticket} />}
          {tab === 'Dependencies' && (
            <>
              <Section title="What gates it" count={ticket.children.length}>
                <Named tickets={ticket.children} empty="Nothing gates this." />
              </Section>
              <Section title="What it gates" count={ticket.gates.length}>
                <Named tickets={ticket.gates} empty="Nothing waits on this." />
              </Section>
            </>
          )}
          {tab === 'Workspace' && (
            <Workspaces ticket={ticket} workspaces={workspaces} onStub={onStub} />
          )}
          {tab === 'Chats' && <Chats chats={chats} onStub={onStub} />}
        </div>
      </div>
    </div>
  );
}

/* ── A rich sample, so every section has something in it ──────────────── */

export function richSample(base: Ticket): {
  ticket: Ticket;
  workspaces: ExecutionWorkspace[];
  chats: ChatSummary[];
} {
  const now = Date.now();
  const ago = (minutes: number): string => new Date(now - minutes * 60_000).toISOString();
  const ticket: Ticket = {
    ...base,
    band: 'needs-you',
    gate: 'ready-for-agent',
    body:
      base.body ||
      'Create the single-page bookmarks shell with URL and optional title fields, an Add action, and accessible labels.',
    criteria:
      base.criteria.length > 0
        ? base.criteria
        : [
            'A single page presents labeled URL and optional title inputs and an Add button.',
            'Inputs and button are keyboard operable.',
            'Layout remains usable at phone-sized and wider viewports.',
          ],
    children: [
      { id: 's1', name: `${base.name.split('-')[0]}-1`, closed: true, closure: 'done' },
      { id: 's2', name: `${base.name.split('-')[0]}-7`, closed: false, closure: null },
    ],
    gates: [{ id: 's3', name: `${base.name.split('-')[0]}-9`, closed: false, closure: null }],
    runs: [
      {
        id: 'r2',
        ticketId: base.id,
        workerId: 'w',
        startedAt: ago(52),
        endedAt: ago(18),
        branch: base.branch,
        stoppedBecause: null,
        changed: 'Six files: page shell, form wiring, labels, and two tests.',
        checks: ['bun test — 42 passed', 'typecheck — clean', 'lint — clean'],
        made: null,
        verdict: null,
      },
      {
        id: 'r1',
        ticketId: base.id,
        workerId: 'w',
        startedAt: ago(60 * 5),
        endedAt: ago(60 * 4),
        branch: base.branch,
        stoppedBecause: null,
        changed: 'Four files: first pass at the shell.',
        checks: ['bun test — 38 passed, 2 failed'],
        made: null,
        verdict: 'sent-back',
      },
    ],
  };
  return {
    ticket,
    workspaces: [
      {
        id: 'ws',
        ticketId: base.id,
        repository: '~/Workspace/demo',
        baseBranch: 'main',
        branch: base.branch,
        agentConfig: 'default',
        createdAt: ago(60 * 5),
      },
    ],
    chats: [
      {
        id: 'c',
        title: 'Read the attached ticket and propose the page structure',
      } as ChatSummary,
    ],
  };
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const ui = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colorVars['--color-background-surface'],
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
    flexShrink: 0,
    height: 44,
    paddingInline: spacingVars['--spacing-4'],
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  crumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    flex: 1,
    minWidth: 0,
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  barTools: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-1'] },
  title: {
    margin: 0,
    fontFamily: typographyVars['--font-family-heading'],
    fontSize: textSizeVars['--font-size-2xl'],
    fontWeight: 600,
    lineHeight: 1.25,
    letterSpacing: '-0.02em',
    textWrap: 'balance',
    overflowWrap: 'anywhere',
  },
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  secondary: {
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  muted: {
    margin: 0,
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  prose: {
    margin: 0,
    maxWidth: '68ch',
    fontSize: textSizeVars['--font-size-base'],
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  count: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 400,
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  section: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  sectionHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacingVars['--spacing-2'],
    margin: 0,
    fontSize: textSizeVars['--font-size-base'],
    fontWeight: 600,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  listRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacingVars['--spacing-2'],
    paddingBlock: spacingVars['--spacing-1-5'],
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
    fontSize: textSizeVars['--font-size-base'],
    lineHeight: 1.5,
  },
  listIcon: {
    display: 'inline-flex',
    marginBlockStart: 3,
    color: colorVars['--color-icon-secondary'],
    flexShrink: 0,
  },
  run: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    paddingBlock: spacingVars['--spacing-2'],
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
    fontSize: textSizeVars['--font-size-base'],
  },
  runHead: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    color: colorVars['--color-icon-secondary'],
  },
  checks: { display: 'flex', flexWrap: 'wrap', gap: spacingVars['--spacing-1'] },
  check: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height: 20,
    paddingInline: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  stack: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  stackTight: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  branch: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-1'], minWidth: 0 },
  wrap: { minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' },
  linkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    width: '100%',
    minWidth: 0,
    paddingBlock: spacingVars['--spacing-1-5'],
    paddingInline: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: {
      default: colorVars['--color-text-primary'],
      ':hover': colorVars['--color-text-accent'],
    },
    fontSize: textSizeVars['--font-size-base'],
    textAlign: 'start',
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
  },
  ellipsis: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  state: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1-5'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-yellow'],
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: spacingVars['--spacing-2'] },
  actionsVertical: { flexDirection: 'column', alignItems: 'stretch' },
  switcher: {
    position: 'fixed',
    insetBlockEnd: 16,
    insetInlineStart: '50%',
    transform: 'translateX(-50%)',
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
    maxWidth: 'calc(100vw - 32px)',
    padding: spacingVars['--spacing-1'],
    paddingInline: spacingVars['--spacing-2'],
    borderRadius: 999,
    backgroundColor: colorVars['--color-background-inverted'],
    color: colorVars['--color-background-surface'],
    boxShadow: shadowVars['--shadow-high'],
    fontSize: textSizeVars['--font-size-sm'],
  },
  segments: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    minWidth: 0,
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
  toggle: {
    height: 24,
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgb(128 128 128 / 0.5)',
    borderRadius: 999,
    backgroundColor: 'transparent',
    color: 'inherit',
    fontSize: textSizeVars['--font-size-sm'],
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  toggleOn: { borderColor: colorVars['--color-accent'] },
  note: {
    paddingInline: spacingVars['--spacing-2'],
    opacity: 0.8,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
});

const rail = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 300px',
    flex: 1,
    minHeight: 0,
    '@media (max-width: 860px)': { gridTemplateColumns: 'minmax(0, 1fr)', overflowY: 'auto' },
  },
  doc: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-6'],
    minHeight: 0,
    overflowY: 'auto',
    paddingBlock: spacingVars['--spacing-6'],
    paddingInline: 'max(24px, calc((100% - 720px) / 2))',
  },
  header: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  rail: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-5'],
    minHeight: 0,
    overflowY: 'auto',
    padding: spacingVars['--spacing-4'],
    borderInlineStartWidth: 1,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colorVars['--color-border'],
    backgroundColor: colorVars['--color-background-body'],
  },
  props: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'], margin: 0 },
  prop: {
    display: 'grid',
    gridTemplateColumns: '96px minmax(0, 1fr)',
    gap: spacingVars['--spacing-2'],
    alignItems: 'baseline',
  },
  propValue: { margin: 0, fontSize: textSizeVars['--font-size-sm'], overflowWrap: 'anywhere' },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    paddingBlockStart: spacingVars['--spacing-4'],
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  groupHead: {
    margin: 0,
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 600,
    color: colorVars['--color-text-secondary'],
  },
});

/* The rail as a box floating beside the document: one scroll for the page, the box
   holding its place while the document scrolls past it. */
const float = stylex.create({
  scroll: {
    display: 'block',
    overflowY: 'auto',
    backgroundColor: colorVars['--color-background-body'],
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 300px',
    alignItems: 'start',
    gap: spacingVars['--spacing-8'],
    maxWidth: 1180,
    marginInline: 'auto',
    paddingBlock: spacingVars['--spacing-6'],
    paddingInline: spacingVars['--spacing-6'],
    '@media (max-width: 860px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  doc: {
    overflowY: 'visible',
    minHeight: 'auto',
    paddingBlock: 0,
    paddingInline: 0,
  },
  box: {
    position: 'sticky',
    insetBlockStart: spacingVars['--spacing-6'],
    maxHeight: 'calc(100vh - 200px)',
    padding: spacingVars['--spacing-4'],
    borderInlineStartWidth: 0,
    borderRadius: 10,
    backgroundColor: colorVars['--color-background-popover'],
    boxShadow: shadowVars['--shadow-low'],
    '@media (max-width: 860px)': { position: 'static', maxHeight: 'none' },
  },
});

const ledger = stylex.create({
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto' },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-6'],
    maxWidth: 880,
    marginInline: 'auto',
    paddingBlock: spacingVars['--spacing-8'],
    paddingInline: spacingVars['--spacing-6'],
  },
  header: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  title: { fontSize: textSizeVars['--font-size-3xl'] },
  facts: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    margin: 0,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
    '@media (max-width: 720px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
  fact: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    paddingBlock: spacingVars['--spacing-2'],
    paddingInlineEnd: spacingVars['--spacing-3'],
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  factValue: { margin: 0, fontSize: textSizeVars['--font-size-base'], overflowWrap: 'anywhere' },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    margin: 0,
    paddingBlockEnd: spacingVars['--spacing-2'],
    borderBlockEndWidth: 2,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border-emphasized'],
    fontSize: textSizeVars['--font-size-base'],
    fontWeight: 600,
  },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: spacingVars['--spacing-6'],
    '@media (max-width: 720px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  foot: {
    flexShrink: 0,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
    backgroundColor: colorVars['--color-background-surface'],
  },
  footInner: {
    maxWidth: 880,
    marginInline: 'auto',
    paddingBlock: spacingVars['--spacing-3'],
    paddingInline: spacingVars['--spacing-6'],
  },
});

const tabs = stylex.create({
  header: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-4'],
    flexShrink: 0,
    paddingBlock: spacingVars['--spacing-5'],
    paddingInline: spacingVars['--spacing-6'],
  },
  headerCopy: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
    flex: '1 1 420px',
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-2'],
  },
  strip: {
    display: 'flex',
    gap: spacingVars['--spacing-1'],
    flexShrink: 0,
    paddingInline: spacingVars['--spacing-5'],
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
    overflowX: 'auto',
  },
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    height: 40,
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: 0,
    borderBlockEndWidth: 2,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: 'transparent',
    backgroundColor: 'transparent',
    color: {
      default: colorVars['--color-text-secondary'],
      ':hover': colorVars['--color-text-primary'],
    },
    fontSize: textSizeVars['--font-size-base'],
    fontWeight: 500,
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: -2,
  },
  tabOn: {
    color: colorVars['--color-text-primary'],
    borderBlockEndColor: colorVars['--color-accent'],
  },
  panel: { flex: 1, minHeight: 0, overflowY: 'auto' },
  panelInner: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-6'],
    maxWidth: 820,
    paddingBlock: spacingVars['--spacing-6'],
    paddingInline: spacingVars['--spacing-6'],
  },
});
