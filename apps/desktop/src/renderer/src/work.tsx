/**
 * The Work surface: one project's tickets, read three ways over one queue.
 *
 * Queue, Board and Split are three readings of the same list, not three
 * surfaces: which ticket is open, which band is being looked at and the order
 * the queue is in belong to this component, so switching views keeps your place
 * and a rank changed on the board is a rank changed in the queue. That is the
 * question the prototype was built to answer, and the answer is kept.
 *
 * Nothing here derives a band. The server decides what band a ticket is in and
 * the surface groups what it was handed, because a window that derived one could
 * draw a state the server would not — and the frontier a run is dispatched from
 * is the same derivation (GH #57). What the surface does decide is what to say
 * when there is no queue to draw: a server that cannot be reached, a machine
 * nobody is signed in on, and a folder that works no project are three different
 * things, and an empty project is a fourth.
 *
 * The panel is the surface's one ticket-reading shape, and the form for writing
 * one takes its place rather than covering it: a ticket is written in the project
 * it is read in, and there is nothing to interrupt to do it.
 */
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Divider } from '@astryxdesign/core/Divider';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Item } from '@astryxdesign/core/Item';
import { List } from '@astryxdesign/core/List';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  borderVars,
  colorVars,
  focusVars,
  spacingVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Copy,
  FileText,
  FolderOpen,
  LayoutGrid,
  Play,
  Plus,
  Rows3,
  SquareKanban,
  X,
  Ticket as TicketIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  bandIcon,
  branchNote,
  byName,
  firstIn,
  holding,
  inBand,
  runChoiceLabel,
  runTelling,
  saidByLabel,
  suggestPrefix,
  when,
} from './workRows.ts';
import type {
  AuthState,
  Band,
  Gate,
  JoinRequest,
  NamedTicket,
  ProjectSummary,
  Ticket,
  TicketChange,
  TicketDraft,
  TicketKind,
  TicketQueue,
  TicketRun,
  TicketSaid,
  WorkspaceSummary,
} from '../../preload/bridge.ts';

/** The three readings of one queue. Which ticket is open belongs to the surface. */
type View = 'queue' | 'board' | 'split';

const VIEWS: { id: View; label: string; icon: LucideIcon; note: string }[] = [
  {
    id: 'queue',
    label: 'Queue',
    icon: Rows3,
    note: 'the bands, one under the other',
  },
  {
    id: 'board',
    label: 'Board',
    icon: SquareKanban,
    note: 'a column a band, ranked inside it',
  },
  {
    id: 'split',
    label: 'Split',
    icon: LayoutGrid,
    note: 'the list and the ticket, side by side',
  },
];

/**
 * The bands, in the order the queue draws them, each with what it means.
 *
 * `Drafts` is last and apart: a draft is not in the frontier, so it is not a band
 * a run is dispatched from and it does not belong among them. `Running` and
 * `Needs you` are absent because nothing can be in them until a claim and a run
 * record exist — a band drawn empty would be a claim about a machine that is not
 * here yet.
 */
const BANDS: { id: Band; label: string; note: string }[] = [
  { id: 'running', label: 'Running', note: 'somebody is working it right now' },
  {
    id: 'needs-you',
    label: 'Needs you',
    note: 'a run left something for a person to answer',
  },
  {
    id: 'ready',
    label: 'Ready',
    note: 'nothing gates it, and it is marked ready',
  },
  { id: 'blocked', label: 'Blocked', note: 'a ticket it names is still open' },
  { id: 'done', label: 'Done', note: 'closed, with a reason' },
  { id: 'draft', label: 'Drafts', note: 'written down, not asked for yet' },
];

/**
 * How often the queue is read again while the Work surface is open.
 *
 * A run makes the queue move on its own — it claims, it proposes, it ends — so a surface
 * that only read when a person acted would show a band that has moved as though it had
 * not. It is not gated on this window's own copy of what is running, which reads well and
 * is wrong: the read after pressing Run can land before the server has recorded the claim,
 * and a surface whose copy says nothing is running never reads again — so the ticket sits
 * in Ready, with Run still offered, while the server has it Running. A copy cannot be what
 * starts looking for what it does not have (GH #75).
 */
const READ_AGAIN_MS = 5_000;

const KIND_VARIANT: Record<TicketKind, 'neutral' | 'info' | 'warning' | 'success' | 'purple'> = {
  prototype: 'neutral',
  bug: 'warning',
  feature: 'info',
  refactor: 'purple',
  question: 'neutral',
  research: 'info',
  spec: 'success',
  map: 'purple',
};

const GATE_LABEL: Record<Gate, string> = {
  draft: 'Draft',
  'ready-for-agent': 'Ready for an agent',
  'ready-for-human': 'Ready for a person',
};

const KINDS: TicketKind[] = [
  'prototype',
  'bug',
  'feature',
  'refactor',
  'question',
  'research',
  'spec',
  'map',
];

/* ── The surface's own arrangement ──────────────────────────────────────── */

const styles = stylex.create({
  root: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
  },
  top: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-3'],
    flexShrink: 0,
    paddingBlock: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-4'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-background-muted'],
  },
  topTitles: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  topActions: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    flexShrink: 0,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  waiting: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    padding: spacingVars['--spacing-4'],
  },
  bandHead: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-0-5'],
    paddingBlockStart: spacingVars['--spacing-3'],
    paddingBlockEnd: spacingVars['--spacing-1'],
    paddingInline: spacingVars['--spacing-4'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  count: {
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
    color: colorVars['--color-text-secondary'],
  },
  abandoned: {
    color: colorVars['--color-text-orange'],
  },
  glyph: {
    display: 'inline-flex',
    alignItems: 'center',
    color: colorVars['--color-text-secondary'],
  },
  glyphReady: { color: colorVars['--color-icon-accent'] },
  glyphAbandoned: { color: colorVars['--color-text-orange'] },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    flexWrap: 'wrap',
    minWidth: 0,
  },

  /* The board, and the ticket over it. */
  board: {
    display: 'flex',
    flexDirection: 'row',
    gap: spacingVars['--spacing-3'],
    flex: 1,
    minHeight: 0,
    padding: spacingVars['--spacing-3'],
    overflowX: 'auto',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    // Columns share the width there is and keep a readable floor when there is not,
    // rather than a fixed width that leaves the last one half off the edge.
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 200,
    minWidth: 200,
    minHeight: 0,
  },
  columnHead: {
    paddingInline: 0,
    backgroundColor: 'transparent',
  },
  cards: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    overflowY: 'auto',
    minHeight: 0,
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
  },
  cardFoot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
  },
  scrim: {
    position: 'absolute',
    inset: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: colorVars['--color-overlay'],
    cursor: 'default',
  },
  drawer: {
    position: 'absolute',
    insetBlock: 0,
    insetInlineEnd: 0,
    display: 'flex',
    flexDirection: 'column',
    width: 'min(460px, 100%)',
    backgroundColor: colorVars['--color-background-surface'],
    borderInlineStartWidth: borderVars['--border-width'],
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colorVars['--color-background-muted'],
  },

  /* The list and the ticket, side by side. */
  split: {
    display: 'flex',
    flexDirection: 'row',
    flex: 1,
    minHeight: 0,
  },
  paneList: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    width: 320,
    minHeight: 0,
    borderInlineEndWidth: borderVars['--border-width'],
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: colorVars['--color-background-muted'],
  },
  paneDetail: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  filters: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-1'],
    padding: spacingVars['--spacing-2'],
    flexShrink: 0,
  },
  worklist: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },

  /* The panel a ticket is read in. */
  panel: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colorVars['--color-background-surface'],
  },
  panelHead: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    flexShrink: 0,
    padding: spacingVars['--spacing-3'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-background-muted'],
  },
  panelBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-4'],
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: spacingVars['--spacing-4'],
    maxWidth: 860,
  },
  panelFoot: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacingVars['--spacing-2'],
    flexShrink: 0,
    padding: spacingVars['--spacing-3'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-background-muted'],
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
  },
  refusal: {
    flexShrink: 0,
    padding: spacingVars['--spacing-3'],
  },
  lines: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  line: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
  },
  lineText: {
    display: 'flex',
    flex: 1,
    minWidth: 0,
  },
  gateName: {
    display: 'flex',
    flex: 1,
    minWidth: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    textAlign: 'start',
    cursor: 'pointer',
    color: colorVars['--color-text-primary'],
    ':focus-visible': {
      outlineWidth: focusVars['--focus-outline-width'],
      outlineStyle: focusVars['--focus-outline-style'],
      outlineColor: focusVars['--focus-outline-color'],
      outlineOffset: focusVars['--focus-outline-offset'],
    },
  },
  branch: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
  },

  /* What a run left on a ticket: its evidence, and the words it went with. */
  evidence: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    minWidth: 0,
  },
  said: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
    // A run can talk for longer than the ticket is long. The transcript is bounded so the
    // facts a person came for stay where they were, and it scrolls rather than growing.
    maxHeight: 420,
    overflowY: 'auto',
  },
  saidLine: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    minWidth: 0,
  },
  saidWords: {
    // The words are written in paragraphs, and a command is written as one line: both are
    // kept as they were written rather than reflowed into each other.
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  field: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: spacingVars['--spacing-2'],
    maxWidth: 640,
  },
  fieldGrow: {
    flex: 1,
    minWidth: 0,
  },
  formFields: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    maxWidth: 640,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
  },

  /* What a folder that works no project is offered. */
  join: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-4'],
    maxWidth: 640,
    padding: spacingVars['--spacing-6'],
  },
  joinList: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
  },
  joinFields: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacingVars['--spacing-3'],
  },
  joinActions: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
    flexWrap: 'wrap',
  },
});

/* ── The surface ────────────────────────────────────────────────────────── */

/**
 * Run `effect` once, when this surface first draws.
 *
 * The one thing here that is a sync with something outside React: the queue is
 * the server's, and reading it is not caused by anything the person did. The
 * escape hatch from the no-useEffect rule, made explicit
 * (.agents/skills/no-use-effect/SKILL.md) — everything else in this file is a
 * handler or a derived value.
 */
function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

export function WorkSurface({
  workspace,
  auth,
  chatIds,
  initialTicketId,
  onBack,
  onOpenChat,
  onJoined,
}: {
  /** The workspace whose project is being worked, or null when there is none. */
  workspace: WorkspaceSummary | null;
  /** Who is signed in, as the window last heard — null until the first answer. */
  auth: AuthState | null;
  /** The chats the window is holding, by id: a run's chat is one of them. */
  chatIds: string[];
  /** A ticket to select when Work was opened from the shaping Workbench. */
  initialTicketId?: string | null;
  /** Return to the project navigator, when this surface was entered from there. */
  onBack?: () => void;
  /** Show a chat: what a run is, and where its words are read. */
  onOpenChat: (chatId: string) => void;
  /** A join happened, so the window can draw the link the folder now has. */
  onJoined: (workspace: WorkspaceSummary) => void;
}) {
  const [queue, setQueue] = useState<TicketQueue | null>(null);
  /** Why there is no queue, when there is none to draw. */
  const [trouble, setTrouble] = useState<string | null>(null);
  const [view, setView] = useState<View>(readView);
  const [openId, setOpenId] = useState<string | null>(initialTicketId ?? null);
  const [band, setBand] = useState<Band | 'all'>('all');
  const [isWriting, setIsWriting] = useState(false);
  /** What the server last refused, in its own words. */
  const [refusal, setRefusal] = useState<string | null>(null);
  /**
   * The name somebody said to open a ticket by, and what came of saying it. The
   * answer belongs to the words rather than to the surface's last write, so it
   * clears when the words change or the name is found — not when the view does.
   */
  const [said, setSaid] = useState('');
  const [miss, setMiss] = useState<string | null>(null);

  const projectId = workspace?.projectId ?? null;

  // A chat's own read: one workspace's queue, asked for again by whoever needs it — the
  // mount, the window coming back, a write, and the beat while a run is going.
  const read = useCallback(async (): Promise<void> => {
    if (workspace === null || projectId === null) return;

    const answer = await window.foundry.loadQueue(workspace.id);

    if (!answer.ok) {
      // Do not leave stale tickets in hand while the queue is unavailable. An open
      // form stays in the normal view branch, so its own draft remains mounted.
      setTrouble(answer.error);
      setQueue(null);
      return;
    }

    setTrouble(null);
    setQueue(answer.value);
  }, [workspace, projectId]);

  useMountEffect(() => {
    void read();

    // And again when the window is looked at: a queue read an hour ago is not what
    // is on the server now, and the window coming back is the moment somebody is
    // about to trust what it shows. The listener goes when the surface does.
    const again = (): void => void read();
    window.addEventListener('focus', again);

    return () => window.removeEventListener('focus', again);
  });

  // The queue is read on a beat while the surface is open, so a run that moves a ticket on
  // its own is drawn where it has moved to.
  useEffect(() => {
    const beat = setInterval(() => void read(), READ_AGAIN_MS);

    return () => clearInterval(beat);
  }, [read]);

  /**
   * One write, and what the server made of it.
   *
   * Every write is followed by a read rather than patched into the list by hand:
   * a band is derived, so one write can move a ticket nobody touched — closing a
   * slice releases the parent that named it — and a surface that guessed at the
   * result would show a queue the server does not have.
   */
  async function wrote(
    act: () => Promise<{ ok: true; value: Ticket } | { ok: false; error: string }>,
  ): Promise<Ticket | null> {
    const answer = await act();
    if (!answer.ok) {
      setRefusal(answer.error);
      return null;
    }

    setRefusal(null);
    await read();
    return answer.value;
  }

  /**
   * One act that answers a run, and what the server made of it.
   *
   * The same shape as `wrote`, which is the same shape of act: the server is asked, its
   * own words are shown when it refuses, and the queue is read again when it does not —
   * because a run that started moves a ticket nobody touched.
   */
  async function acted<T>(
    act: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>,
  ): Promise<boolean> {
    const answer = await act();

    if (!answer.ok) {
      setRefusal(answer.error);
      return false;
    }

    setRefusal(null);
    await read();
    return true;
  }

  /**
   * Move a ticket to the front of the band it is already in.
   *
   * One rank, written once: a rank orders a ticket inside its band and never
   * moves it between bands, so this is the whole of what a drag can mean. The
   * band is not sent, because a band is derived — the ticket is in Ready or it
   * is not, and nothing here decides that.
   */
  async function promote(id: string): Promise<void> {
    const ready = tickets.filter((each) => each.band === 'ready' && each.id !== id);
    const top = ready.reduce(
      (lowest, each) => Math.min(lowest, each.rank),
      Number.MAX_SAFE_INTEGER,
    );

    await wrote(() =>
      window.foundry.changeTicket(id, {
        rank: top === Number.MAX_SAFE_INTEGER ? 0 : top - 1,
      }),
    );
  }

  if (workspace === null) {
    return (
      <div {...stylex.props(styles.root)}>
        <div {...stylex.props(styles.scroll)}>
          <EmptyState
            title="No folder to work in yet"
            description="Open a folder from the sidebar. A folder is a workspace, and a workspace is where a project's work runs."
            icon={<Icon icon={FolderOpen} size="lg" />}
            headingLevel={2}
          />
        </div>
      </div>
    );
  }

  if (projectId === null) {
    return <Join workspace={workspace} auth={auth} onJoined={onJoined} />;
  }

  const tickets = queue?.tickets ?? [];
  const counts = queue?.counts ?? {
    draft: 0,
    ready: 0,
    blocked: 0,
    running: 0,
    'needs-you': 0,
    done: 0,
  };
  /**
   * What the surface is showing, which is the same answer for the list and the panel.
   *
   * Split has nowhere to put a ticket that is not open, so a band it is filtered to
   * falls back to its first — and the panel follows that fallback rather than the
   * click, because a list with nothing beside it is the one thing the reading is
   * for. The other two views open nothing until something is chosen.
   */
  const shownId = view === 'split' ? (openId ?? firstIn(tickets, band)?.id ?? null) : openId;
  const open = tickets.find((each) => each.id === shownId) ?? null;
  /** Where a ticket opens, which is the one thing the views disagree about. */
  const placement = view === 'board' ? 'over' : view === 'split' ? 'beside' : 'inline';
  const closePanel = (): void => {
    setIsWriting(false);
    setOpenId(null);
    setRefusal(null);
  };
  const openTicket = (id: string): void => {
    setIsWriting(false);
    setOpenId(id);
  };

  /** Whether a name can be looked up at all: a queue in hand, and something said. */
  const canOpen = queue !== null && said.trim() !== '';

  /**
   * Open the ticket somebody named, or say this project has no ticket by that
   * name. The words stay in the field, because a name typed wrong is a name
   * about to be typed again.
   *
   * With no queue in hand there is nothing to look in and nothing to say about
   * names: a lookup over a list that failed to load would blame the project for
   * the server being away, which is the one thing a queue read must never do.
   */
  const openSaid = (): void => {
    if (!canOpen) return;

    const named = said.trim();
    const found = byName(tickets, named);
    if (found === undefined) {
      setMiss(`No ticket in this project is called ${named}.`);
      return;
    }

    setMiss(null);
    setSaid('');
    openTicket(found.id);
  };

  const panel = isWriting ? (
    <TicketForm
      placement={placement}
      refusal={refusal}
      trouble={trouble}
      onRetry={() => void read()}
      onLeave={closePanel}
      onWrite={async (draft) => {
        const written = await wrote(() => window.foundry.writeTicket(workspace.id, draft));
        if (written !== null) {
          setIsWriting(false);
          setOpenId(written.id);
        }
      }}
    />
  ) : open === null ? null : (
    <TicketReading
      ticket={open}
      placement={placement}
      refusal={refusal}
      chatIds={chatIds}
      onLeave={closePanel}
      onOpen={openTicket}
      onOpenChat={onOpenChat}
      onRefuse={setRefusal}
      onWrite={(change) => wrote(() => window.foundry.changeTicket(open.id, change))}
      onGate={(gatedBy) => wrote(() => window.foundry.gateTicket(open.id, gatedBy))}
      onUngate={(gatedBy) => wrote(() => window.foundry.ungateTicket(open.id, gatedBy))}
      onRun={() => acted(() => window.foundry.startRun(workspace.id, open.id))}
      onQuestion={() => acted(() => window.foundry.openQuestion(workspace.id, open.id))}
      onTakeOver={() => acted(() => window.foundry.takeOverClaim(open.id))}
      onLetGo={() => acted(() => window.foundry.releaseClaim(open.id))}
      onResolve={() =>
        acted(() =>
          window.foundry.resolveRun(
            workspace.id,
            open.id,
            refusal?.replace(/^Merge conflict:\s*/, '') ?? 'The spec branch has conflicts.',
          ),
        )
      }
      onJudge={(verdict) => {
        // The newest run is the one with something to answer: a ticket waits on a person
        // because of what its last run did.
        const last = open.runs[0];

        return last === undefined
          ? Promise.resolve(false)
          : acted(() => window.foundry.judgeRun(open.id, last.id, verdict, workspace.id));
      }}
    />
  );

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.top)}>
        <div {...stylex.props(styles.topTitles)}>
          {onBack !== undefined && (
            <Button
              label="Back to projects"
              icon={<Icon icon={ArrowLeft} size="sm" />}
              variant="ghost"
              size="sm"
              onClick={onBack}
            />
          )}
          <Text type="label" weight="medium" maxLines={1}>
            {queue?.project.name ?? workspace.name}
          </Text>
          <Text type="supporting" color="secondary" maxLines={1}>
            {queue?.project.prefix ?? '—'} · {VIEWS.find((each) => each.id === view)?.note}
          </Text>
        </div>
        <div {...stylex.props(styles.topActions)}>
          <SegmentedControl
            value={view}
            onChange={(next) => {
              if (!isView(next)) return;
              setView(next);
              setRefusal(null);
              window.history.replaceState(null, '', `?view=${next}`);
            }}
            label="How to read this queue"
            size="sm"
          >
            {VIEWS.map((each) => (
              <SegmentedControlItem
                key={each.id}
                value={each.id}
                label={each.label}
                icon={<Icon icon={each.icon} size="sm" />}
              />
            ))}
          </SegmentedControl>
          {/* A name is what somebody has in hand when they have nothing else — a
              chat message, a commit, a colleague talking — so it is asked for
              where the queue's own controls are. */}
          <TextInput
            label="Open a ticket by its name"
            isLabelHidden
            size="sm"
            width={150}
            value={said}
            placeholder="Say its name"
            isDisabled={queue === null}
            disabledMessage={trouble === null ? 'The queue is still being read.' : undefined}
            status={miss === null || queue === null ? undefined : { type: 'error', message: miss }}
            onChange={(next) => {
              setSaid(next);
              setMiss(null);
            }}
            onEnter={openSaid}
          />
          <Button label="Open" size="sm" variant="ghost" isDisabled={!canOpen} onClick={openSaid} />
          <Button
            label="New ticket"
            icon={<Icon icon={Plus} size="sm" />}
            variant="secondary"
            size="sm"
            onClick={() => {
              setOpenId(null);
              setIsWriting(true);
              setRefusal(null);
            }}
          />
        </div>
      </div>

      {trouble !== null && !isWriting ? (
        <div {...stylex.props(styles.scroll)}>
          <QueueReadFailure trouble={trouble} onRetry={() => void read()} />
        </div>
      ) : queue === null && !isWriting ? (
        // The shape of what is coming, rather than a spinner in the middle of
        // nothing: a queue is rows, and three of them say so while it is read.
        <div {...stylex.props(styles.waiting)} aria-busy="true" aria-label="Reading the queue">
          <Skeleton width="30%" height={14} />
          <Skeleton width="75%" height={14} index={1} />
          <Skeleton width="65%" height={14} index={2} />
          <Skeleton width="70%" height={14} index={3} />
        </div>
      ) : tickets.length === 0 && !isWriting ? (
        <div {...stylex.props(styles.scroll)}>
          <EmptyState
            title="Nothing written down yet"
            description="A ticket says what to build and how it is known to be done. Write the first one and it lands among the drafts."
            icon={<Icon icon={FileText} size="lg" />}
            headingLevel={2}
            actions={
              <Button
                label="New ticket"
                icon={<Icon icon={Plus} size="sm" />}
                variant="primary"
                onClick={() => setIsWriting(true)}
              />
            }
          />
        </div>
      ) : view === 'board' ? (
        <BoardView
          tickets={tickets}
          selected={openId}
          onOpen={openTicket}
          onPromote={(id) => void promote(id)}
          panel={panel}
          onLeave={closePanel}
        />
      ) : view === 'split' ? (
        <SplitView
          tickets={tickets}
          counts={counts}
          band={band}
          onBand={setBand}
          selected={shownId ?? null}
          onOpen={openTicket}
          panel={panel}
        />
      ) : (
        <QueueView tickets={tickets} selected={openId} onOpen={openTicket} panel={panel} />
      )}
    </div>
  );
}

function QueueReadFailure({ trouble, onRetry }: { trouble: string; onRetry: () => void }) {
  return (
    <div {...stylex.props(styles.refusal)}>
      <Banner
        status="error"
        title="The queue could not be read"
        description={trouble}
        endContent={<Button label="Try again" size="sm" variant="secondary" onClick={onRetry} />}
      />
    </div>
  );
}

/* ── Joining a project ──────────────────────────────────────────────────── */

/**
 * What a folder that works no project is offered.
 *
 * A workspace with no project is an ordinary state, not a fault, so this is a
 * page rather than a warning: the projects the server holds, or the making of a
 * new one. The offer can be put off — the folder stays usable for chat — and a
 * refusal (a prefix another project holds) is shown where it was asked for,
 * because it is a thing to act on rather than a failure of the app.
 */
function Join({
  workspace,
  auth,
  onJoined,
}: {
  workspace: WorkspaceSummary;
  auth: AuthState | null;
  onJoined: (workspace: WorkspaceSummary) => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [prefix, setPrefix] = useState(suggestPrefix(workspace.name));

  async function read(): Promise<void> {
    setTrouble(null);
    const answer = await window.foundry.joinableProjects();
    if (!answer.ok) {
      setTrouble(answer.error);
      setProjects(null);
      return;
    }

    setProjects(answer.value);
  }

  useMountEffect(() => {
    void read();
  });

  async function join(request: JoinRequest): Promise<void> {
    setIsJoining(true);
    const answer = await window.foundry.joinWorkspace(workspace.id, request);
    setIsJoining(false);

    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }

    onJoined(answer.value);
  }

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.top)}>
        <div {...stylex.props(styles.topTitles)}>
          <Text type="label" weight="medium" maxLines={1}>
            {workspace.name}
          </Text>
          <Text type="supporting" color="secondary" maxLines={1}>
            this folder is not working a project yet
          </Text>
        </div>
      </div>

      <div {...stylex.props(styles.scroll)}>
        <div {...stylex.props(styles.join)}>
          <Text type="large" weight="medium">
            Which project does this folder work?
          </Text>
          <Text type="supporting" color="secondary">
            A project is where the work is kept, and it outlives any one checkout. Join one the
            server already holds, or start a new one here. Nothing is written into the folder, and
            its chats stay where they are.
          </Text>

          {trouble !== null && (
            <Banner
              status="error"
              title="Foundry could not answer"
              description={trouble}
              endContent={
                <Button
                  label="Try again"
                  size="sm"
                  variant="secondary"
                  onClick={() => void read()}
                />
              }
            />
          )}

          {projects === null && trouble === null && (
            <div
              {...stylex.props(styles.waiting)}
              aria-busy="true"
              aria-label="Reading the projects"
            >
              <Skeleton width="40%" height={14} />
              <Skeleton width="70%" height={14} index={1} />
            </div>
          )}

          {projects !== null && (
            <>
              <Divider />
              <Text type="label" weight="medium">
                Already on the server
              </Text>
              {projects.length === 0 ? (
                <Text type="supporting" color="secondary">
                  The server holds no projects yet. This folder can be the first.
                </Text>
              ) : (
                <List density="compact" hasDividers>
                  {projects.map((each) => (
                    <Item
                      key={each.id}
                      label={each.name}
                      description={`${each.prefix} · tickets are named ${each.prefix}-1, ${each.prefix}-2`}
                      endContent={
                        <Button
                          label="Join"
                          variant="secondary"
                          size="sm"
                          isDisabled={isJoining}
                          onClick={() => void join({ kind: 'existing', projectId: each.id })}
                        />
                      }
                    />
                  ))}
                </List>
              )}

              <Divider />
              <Text type="label" weight="medium">
                Or start a new project
              </Text>
              <div {...stylex.props(styles.joinFields)}>
                <div {...stylex.props(styles.fieldGrow)}>
                  <TextInput
                    label="Name"
                    value={name}
                    onChange={setName}
                    description="What the project is called on the server."
                    size="sm"
                  />
                </div>
                <div {...stylex.props(styles.fieldGrow)}>
                  <TextInput
                    label="Prefix"
                    value={prefix}
                    onChange={(next) => setPrefix(next.toUpperCase())}
                    description="Two to six letters and digits. Tickets are named with it, so it cannot change later."
                    size="sm"
                  />
                </div>
              </div>
              <div {...stylex.props(styles.joinActions)}>
                <Button
                  label="Start it, and work here"
                  variant="primary"
                  size="sm"
                  isDisabled={isJoining || name.trim() === '' || prefix.trim() === ''}
                  onClick={() => void join({ kind: 'new', name, prefix })}
                />
                <Text type="supporting" color="secondary">
                  {auth?.signedIn === false
                    ? 'Nobody is signed in — a project lives on the server.'
                    : 'The folder keeps working for chat either way.'}
                </Text>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── The three readings ─────────────────────────────────────────────────── */

interface ViewProps {
  tickets: Ticket[];
  selected: string | null;
  onOpen: (id: string) => void;
  panel: ReactNode;
}

function QueueView({ tickets, onOpen, panel }: ViewProps) {
  // The panel takes the queue's place whenever there is one — a ticket being read,
  // or one being written — because that is what `inline` means here. The queue is
  // what is left when there is nothing to read.
  if (panel !== null) return <div {...stylex.props(styles.scroll)}>{panel}</div>;

  return (
    <div {...stylex.props(styles.scroll)}>
      {BANDS.map((band) => (
        <Band key={band.id} band={band} tickets={inBand(tickets, band.id)} onOpen={onOpen} />
      ))}
    </div>
  );
}

function BoardView({
  tickets,
  selected,
  onOpen,
  onPromote,
  panel,
  onLeave,
}: ViewProps & { onPromote: (id: string) => void; onLeave: () => void }) {
  return (
    <div {...stylex.props(styles.board)}>
      {BANDS.map((band) => (
        <div key={band.id} {...stylex.props(styles.column)}>
          <div {...stylex.props(styles.bandHead, styles.columnHead)}>
            <BandHead band={band} count={inBand(tickets, band.id).length} />
          </div>
          <div {...stylex.props(styles.cards)}>
            {inBand(tickets, band.id).map((ticket) => (
              <ClickableCard
                key={ticket.id}
                label={`Open ${ticket.name}`}
                padding={2}
                variant={ticket.id === selected ? 'muted' : 'default'}
                onClick={() => onOpen(ticket.id)}
              >
                <span {...stylex.props(styles.cardBody)}>
                  <Text type="label" weight="medium" maxLines={2}>
                    {ticket.title || 'Untitled'}
                  </Text>
                  <span {...stylex.props(styles.meta)}>
                    <Text type="supporting" color="secondary">
                      {ticket.name}
                    </Text>
                    <KindTag kind={ticket.kind} />
                  </span>
                  <span {...stylex.props(styles.cardFoot)}>
                    <Holding ticket={ticket} />
                    {band.id === 'ready' && (
                      <IconButton
                        label={`Move ${ticket.name} to the front of Ready`}
                        icon={<Icon icon={ArrowUp} size="sm" />}
                        onClick={(event) => {
                          event.stopPropagation();
                          onPromote(ticket.id);
                        }}
                      />
                    )}
                  </span>
                </span>
              </ClickableCard>
            ))}
            {inBand(tickets, band.id).length === 0 && (
              <Text type="supporting" color="secondary">
                Nothing here.
              </Text>
            )}
          </div>
        </div>
      ))}

      {panel !== null && (
        <>
          {/* The scrim is a button rather than a decorated div: leaving by clicking
              outside the ticket is an action, and one the keyboard can take too. */}
          <button
            type="button"
            aria-label="Close the ticket"
            {...stylex.props(styles.scrim)}
            onClick={onLeave}
          />
          <div {...stylex.props(styles.drawer)}>{panel}</div>
        </>
      )}
    </div>
  );
}

function SplitView({
  tickets,
  counts,
  band,
  onBand,
  selected,
  onOpen,
  panel,
}: ViewProps & {
  counts: Record<Band, number>;
  band: Band | 'all';
  onBand: (next: Band | 'all') => void;
}) {
  const shown = band === 'all' ? tickets : inBand(tickets, band);

  return (
    <div {...stylex.props(styles.split)}>
      <div {...stylex.props(styles.paneList)}>
        <div {...stylex.props(styles.filters)}>
          <Button
            label={`Everything ${tickets.length}`}
            size="sm"
            variant={band === 'all' ? 'secondary' : 'ghost'}
            onClick={() => onBand('all')}
          />
          {BANDS.map((each) => (
            <Button
              key={each.id}
              label={`${each.label} ${counts[each.id]}`}
              size="sm"
              variant={band === each.id ? 'secondary' : 'ghost'}
              onClick={() => onBand(each.id)}
            />
          ))}
        </div>
        <div {...stylex.props(styles.worklist)}>
          <List density="compact" hasDividers>
            {shown.map((ticket) => (
              <Item
                key={ticket.id}
                as="li"
                isSelected={ticket.id === selected}
                startContent={<StateGlyph ticket={ticket} />}
                label={ticket.title || 'Untitled'}
                labelLines={1}
                description={`${ticket.name} · ${GATE_LABEL[ticket.gate]}`}
                descriptionLines={1}
                onClick={() => onOpen(ticket.id)}
              />
            ))}
          </List>
          {shown.length === 0 && (
            <Text type="supporting" color="secondary">
              Nothing in this band.
            </Text>
          )}
        </div>
      </div>
      <div {...stylex.props(styles.paneDetail)}>{panel}</div>
    </div>
  );
}

/* ── Leaves the views share: what a thing is, not where it goes ─────────── */

function KindTag({ kind }: { kind: TicketKind }) {
  return <Badge variant={KIND_VARIANT[kind]} label={kind} />;
}

/**
 * What a ticket is waiting on, in one line, wherever it is drawn small.
 *
 * The icon and the words come from one place (`workRows.ts`), so a row cannot end
 * up with a clock beside "ready to run".
 */
function Holding({ ticket }: { ticket: Ticket }) {
  const said = holding(ticket);

  return (
    <span {...stylex.props(styles.tag, ticket.closure === 'wontfix' && styles.abandoned)}>
      <Icon icon={said.icon} size="sm" />
      {said.words}
    </span>
  );
}

function StateGlyph({ ticket }: { ticket: Ticket }) {
  return (
    <span
      {...stylex.props(
        styles.glyph,
        ticket.band === 'ready' && styles.glyphReady,
        ticket.closure === 'wontfix' && styles.glyphAbandoned,
      )}
    >
      <Icon icon={bandIcon(ticket)} size="sm" />
    </span>
  );
}

function BandHead({ band, count }: { band: { label: string; note: string }; count: number }) {
  return (
    <>
      <Text type="label" weight="medium">
        {band.label} <span {...stylex.props(styles.count)}>{count}</span>
      </Text>
      <Text type="supporting" color="secondary">
        {band.note}
      </Text>
    </>
  );
}

function Band({
  band,
  tickets,
  onOpen,
}: {
  band: { id: Band | 'draft'; label: string; note: string };
  tickets: Ticket[];
  onOpen: (id: string) => void;
}) {
  if (tickets.length === 0) return null;

  return (
    <div>
      <div {...stylex.props(styles.bandHead)}>
        <BandHead band={band} count={tickets.length} />
      </div>
      <List density="compact" hasDividers>
        {tickets.map((ticket) => (
          <Item
            key={ticket.id}
            as="li"
            startContent={<StateGlyph ticket={ticket} />}
            label={ticket.title || 'Untitled'}
            labelLines={1}
            description={
              <span {...stylex.props(styles.meta)}>
                <Text type="supporting" color="secondary">
                  {ticket.name}
                </Text>
                {band.id !== 'draft' && <KindTag kind={ticket.kind} />}
                <Holding ticket={ticket} />
              </span>
            }
            endContent={
              <Text type="supporting" color="secondary">
                {ticket.author?.name ?? 'nobody'}
              </Text>
            }
            onClick={() => onOpen(ticket.id)}
          />
        ))}
      </List>
    </div>
  );
}

/* ── The ticket — one panel, drawn in one of three places ───────────────── */

/**
 * The frame a ticket is read or written in. The views disagree about where it
 * sits and what is on screen with it, not about what it says: `inline` takes the
 * queue's place, `over` covers the board behind a scrim, `beside` holds a column
 * of its own. Only `placement` differs here, and all it decides is how you leave.
 */
function TicketPanel({
  placement,
  onLeave,
  refusal,
  head,
  foot,
  children,
}: {
  placement: 'inline' | 'over' | 'beside';
  onLeave: () => void;
  refusal: string | null;
  head: ReactNode;
  foot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.panelHead)}>
        {placement !== 'beside' && (
          <div>
            <Button
              label={placement === 'over' ? 'Close' : 'Back to the queue'}
              icon={<Icon icon={placement === 'over' ? X : ArrowLeft} size="sm" />}
              variant="ghost"
              size="sm"
              onClick={onLeave}
            />
          </div>
        )}
        {head}
      </div>
      {refusal !== null && (
        <div {...stylex.props(styles.refusal)}>
          <Banner status="error" title="Foundry would not take that" description={refusal} />
        </div>
      )}
      <div {...stylex.props(styles.panelBody)}>{children}</div>
      {foot !== undefined && <div {...stylex.props(styles.panelFoot)}>{foot}</div>}
    </div>
  );
}

/** One ticket in full, with everything that can be done to it. */
function TicketReading({
  ticket,
  placement,
  refusal,
  chatIds,
  onLeave,
  onOpen,
  onOpenChat,
  onRefuse,
  onWrite,
  onGate,
  onUngate,
  onRun,
  onQuestion,
  onTakeOver,
  onLetGo,
  onJudge,
  onResolve,
}: {
  ticket: Ticket;
  placement: 'inline' | 'over' | 'beside';
  refusal: string | null;
  chatIds: string[];
  onLeave: () => void;
  onOpen: (id: string) => void;
  onOpenChat: (chatId: string) => void;
  onRefuse: (message: string | null) => void;
  onWrite: (change: TicketChange) => Promise<Ticket | null>;
  onGate: (gatedBy: string) => Promise<Ticket | null>;
  onUngate: (gatedBy: string) => Promise<Ticket | null>;
  onRun: () => Promise<boolean>;
  onQuestion: () => Promise<boolean>;
  onTakeOver: () => Promise<boolean>;
  onLetGo: () => Promise<boolean>;
  onJudge: (verdict: 'accepted' | 'sent-back') => Promise<boolean>;
  onResolve: () => Promise<boolean>;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [isGating, setIsGating] = useState(false);
  const [named, setNamed] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  async function run(act: () => Promise<unknown>): Promise<void> {
    setIsBusy(true);
    await act();
    setIsBusy(false);
  }

  return (
    <TicketPanel
      placement={placement}
      onLeave={onLeave}
      refusal={refusal}
      head={
        <>
          <Text type="label" weight="medium">
            {ticket.name}
          </Text>
          <Text type="supporting" color="secondary" maxLines={2}>
            {ticket.title || 'Untitled'}
          </Text>
          <div {...stylex.props(styles.meta)}>
            <KindTag kind={ticket.kind} />
            <Text type="supporting" color="secondary">
              {GATE_LABEL[ticket.gate]}
            </Text>
            <Text type="supporting" color="secondary">
              rank {ticket.rank}
            </Text>
            {ticket.author !== null && (
              <Text type="supporting" color="secondary">
                written by {ticket.author.name}
              </Text>
            )}
          </div>
        </>
      }
      foot={
        ticket.closedAt !== null || isEditing ? undefined : isClosing ? (
          <>
            <Button
              label="Done"
              size="sm"
              variant="primary"
              isDisabled={isBusy}
              onClick={() =>
                void run(async () => {
                  await onWrite({ closure: 'done' });
                  setIsClosing(false);
                })
              }
            />
            <Button
              label="Won’t do it"
              size="sm"
              variant="secondary"
              isDisabled={isBusy}
              onClick={() =>
                void run(async () => {
                  await onWrite({ closure: 'wontfix' });
                  setIsClosing(false);
                })
              }
            />
            <Button label="Cancel" size="sm" variant="ghost" onClick={() => setIsClosing(false)} />
          </>
        ) : (
          <>
            {/* Run is offered on a ready ticket and nowhere else, because whether a ticket
                can be picked up is the server's answer and its own words are what is shown
                when it says no. */}
            {ticket.band === 'ready' && (
              <Button
                label="Run it"
                size="sm"
                variant="primary"
                isDisabled={isBusy}
                onClick={() => void run(onRun)}
              />
            )}
            {ticket.kind === 'question' &&
              (ticket.band === 'ready' || ticket.band === 'needs-you') && (
                <Button
                  label={ticket.band === 'needs-you' ? 'Resume with Kira' : 'Work with Kira'}
                  size="sm"
                  variant="primary"
                  isDisabled={isBusy}
                  onClick={() => void run(onQuestion)}
                />
              )}
            {/* A claim whose machine stopped answering, which only a person can take on. */}
            {ticket.claim?.stale === true && (
              <Button
                label="Take it over"
                size="sm"
                variant="primary"
                isDisabled={isBusy}
                onClick={() => void run(onTakeOver)}
              />
            )}
            {/* A run left a proposal: the person it is for says what they make of it. */}
            {ticket.band === 'needs-you' && (
              <>
                {refusal?.startsWith('Merge conflict:') === true && (
                  <Button
                    label="Resolve with Kira"
                    size="sm"
                    variant="primary"
                    isDisabled={isBusy}
                    onClick={() => void run(onResolve)}
                  />
                )}
                <Button
                  label="Accept it"
                  size="sm"
                  variant="primary"
                  isDisabled={isBusy}
                  onClick={() => void run(() => onJudge('accepted'))}
                />
                <Button
                  label="Send it back"
                  size="sm"
                  variant="secondary"
                  isDisabled={isBusy}
                  onClick={() => void run(() => onJudge('sent-back'))}
                />
              </>
            )}
            {/* A claim held by hand is held by a person: only they can let it go, and
                without this a ticket taken over would sit in Running for good. */}
            {ticket.claim !== null && ticket.claim.workerId === null && (
              <Button
                label="Let it go"
                size="sm"
                variant="ghost"
                isDisabled={isBusy}
                onClick={() => void run(onLetGo)}
              />
            )}
            {ticket.gate === 'draft' ? (
              <>
                <Button
                  label="Ready for an agent"
                  size="sm"
                  variant="primary"
                  isDisabled={isBusy}
                  onClick={() => void run(() => onWrite({ gate: 'ready-for-agent' }))}
                />
                <Button
                  label="Ready for a person"
                  size="sm"
                  variant="secondary"
                  isDisabled={isBusy}
                  onClick={() => void run(() => onWrite({ gate: 'ready-for-human' }))}
                />
              </>
            ) : (
              <Button
                label="Back to a draft"
                size="sm"
                variant="secondary"
                isDisabled={isBusy}
                onClick={() => void run(() => onWrite({ gate: 'draft' }))}
              />
            )}
            <Button
              label="Edit"
              size="sm"
              variant="ghost"
              isDisabled={isBusy}
              onClick={() => {
                setIsEditing(true);
                onRefuse(null);
              }}
            />
            <Button
              label="Close it"
              size="sm"
              variant="ghost"
              isDisabled={isBusy}
              onClick={() => {
                setIsClosing(true);
                onRefuse(null);
              }}
            />
          </>
        )
      }
    >
      {isEditing ? (
        // Correcting a ticket takes the panel's whole body rather than sitting
        // inside one of its sections: what is being edited is the contract, and
        // leaving the reading below the form would say it twice, once stale.
        <TicketEdit
          ticket={ticket}
          isBusy={isBusy}
          onCancel={() => setIsEditing(false)}
          onSave={(change) =>
            void run(async () => {
              // The editor stays open when the server refuses: the words typed into
              // it are the person's, and a refused write is not a reason to take them
              // away — removing the last criterion from a ticket an agent runs is
              // exactly the write that gets refused (GH #63).
              const saved = await onWrite(change);
              if (saved !== null) setIsEditing(false);
            })
          }
        />
      ) : (
        <>
          <section {...stylex.props(styles.section)}>
            <Text type="label" weight="medium">
              What to build
            </Text>
            <Text type="body">{ticket.body === '' ? 'Nothing written yet.' : ticket.body}</Text>
          </section>

          <section {...stylex.props(styles.section)}>
            <Text type="label" weight="medium">
              Acceptance criteria
            </Text>
            {ticket.criteria.length === 0 ? (
              <Text type="supporting" color="secondary">
                Nothing says how this is known to be done — so it cannot be marked ready for an
                agent.
              </Text>
            ) : (
              <ul {...stylex.props(styles.lines)}>
                {ticket.criteria.map((line, at) => (
                  <li key={`${at}-${line}`} {...stylex.props(styles.line)}>
                    <Icon icon={CircleDashed} size="sm" />
                    <Text type="supporting">{line === '' ? '(an empty line)' : line}</Text>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {ticket.kind === 'map' && (ticket.decisionsSoFar?.length ?? 0) > 0 && (
            <section {...stylex.props(styles.section)}>
              <Text type="label" weight="medium">
                Decisions so far
              </Text>
              <ul {...stylex.props(styles.lines)}>
                {ticket.decisionsSoFar?.map((outcome) => (
                  <li key={outcome.id} {...stylex.props(styles.line)}>
                    <Icon icon={CircleCheck} size="sm" />
                    <Text type="supporting">{outcome.answer}</Text>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* What a run made of it, above the queue's own facts: on a ticket somebody or
              something has worked, this is what the ticket is waiting on. */}
          <RunHistory ticket={ticket} chatIds={chatIds} onOpenChat={onOpenChat} />

          <section {...stylex.props(styles.section)}>
            <Text type="label" weight="medium">
              What gates it
            </Text>
            {ticket.children.length === 0 ? (
              <Text type="supporting" color="secondary">
                Nothing gates this. A ticket names the tickets that hold it up, and a parent names
                its slices.
              </Text>
            ) : (
              <>
                <Text type="supporting" color="secondary">
                  {ticket.children.filter((each) => each.closed).length} of {ticket.children.length}{' '}
                  closed
                </Text>
                <ul {...stylex.props(styles.lines)}>
                  {ticket.children.map((each) => (
                    <li key={each.id} {...stylex.props(styles.line)}>
                      <NamedGlyph ticket={each} />
                      <button
                        type="button"
                        {...stylex.props(styles.gateName)}
                        onClick={() => onOpen(each.id)}
                      >
                        <Text type="supporting">
                          {each.name}
                          {each.closure === 'wontfix' ? ' — closed without being done' : ''}
                        </Text>
                      </button>
                      <IconButton
                        label={`Take ${each.name} off what gates this`}
                        icon={<Icon icon={X} size="sm" />}
                        isDisabled={isBusy}
                        onClick={() => void run(() => onUngate(each.id))}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}

            {isGating ? (
              <>
                <div {...stylex.props(styles.field)}>
                  <div {...stylex.props(styles.fieldGrow)}>
                    <TextInput
                      label="Which ticket holds this up"
                      value={named}
                      onChange={setNamed}
                      description="By its name — FND-12 — or by anything else the server knows it as."
                      size="sm"
                    />
                  </div>
                </div>
                <div {...stylex.props(styles.actions)}>
                  <Button
                    label="Add the gate"
                    size="sm"
                    variant="secondary"
                    isDisabled={isBusy || named.trim() === ''}
                    onClick={() =>
                      void run(async () => {
                        const held = await onGate(named.trim());
                        if (held !== null) {
                          setNamed('');
                          setIsGating(false);
                        }
                      })
                    }
                  />
                  <Button
                    label="Cancel"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsGating(false);
                      onRefuse(null);
                    }}
                  />
                </div>
              </>
            ) : (
              <div>
                <Button
                  label="Add a gate"
                  icon={<Icon icon={Plus} size="sm" />}
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setIsGating(true);
                    onRefuse(null);
                  }}
                />
              </div>
            )}
          </section>

          {ticket.gates.length > 0 && (
            <section {...stylex.props(styles.section)}>
              <Text type="label" weight="medium">
                What it gates
              </Text>
              <ul {...stylex.props(styles.lines)}>
                {ticket.gates.map((each) => (
                  <li key={each.id} {...stylex.props(styles.line)}>
                    <Icon icon={ArrowUp} size="sm" />
                    <button
                      type="button"
                      {...stylex.props(styles.gateName)}
                      onClick={() => onOpen(each.id)}
                    >
                      <Text type="supporting">
                        {each.name}
                        {each.closed ? ' — closed' : ' — still open'}
                      </Text>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section {...stylex.props(styles.section)}>
            <Text type="label" weight="medium">
              The branch
            </Text>
            <div {...stylex.props(styles.branch)}>
              <Text type="code">{ticket.branch}</Text>
              <IconButton
                label={`Copy ${ticket.branch}`}
                icon={<Icon icon={Copy} size="sm" />}
                onClick={() => copyText(ticket.branch)}
              />
            </div>
            <Text type="supporting" color="secondary">
              {branchNote(ticket)}
            </Text>
          </section>

          <section {...stylex.props(styles.section)}>
            <Text type="label" weight="medium">
              Written and changed
            </Text>
            <Text type="supporting" color="secondary">
              written {when(ticket.createdAt)} · last changed {when(ticket.updatedAt)}
              {ticket.closedAt === null
                ? ''
                : ` · closed ${when(ticket.closedAt)} as ${ticket.closure === 'wontfix' ? 'something that will not be done' : 'done'}`}
            </Text>
          </section>
        </>
      )}
    </TicketPanel>
  );
}

/**
 * A ticket's runs, newest first, with one of them drawn.
 *
 * The newest is drawn unless somebody picked another. A ticket that has been run several
 * times keeps all of them, because what the ticket is waiting on is the newest run's
 * proposal, and what it did before that is how a person judges whether to trust it
 * (GH #68).
 *
 * An older run has no chat in this window — the row for a run is cleared when its ticket is
 * run again — so its words are read from the transcript the project keeps.
 */
function RunHistory({
  ticket,
  chatIds,
  onOpenChat,
}: {
  ticket: Ticket;
  chatIds: string[];
  onOpenChat: (chatId: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  // A run picked on another ticket is not one of this ticket's, so an id that is not here
  // falls back to the newest: the panel never has to be told which ticket it is showing.
  const shown = ticket.runs.find((each) => each.id === picked) ?? ticket.runs[0];
  const others = ticket.runs.filter((each) => each.id !== shown?.id);

  if (shown === undefined) return null;

  return (
    <>
      <RunReading
        key={`${ticket.id}:${shown.id}`}
        ticketId={ticket.id}
        run={shown}
        // A run's chat is a chat, and this window is holding it: the ticket opens it
        // rather than saying the same things again in a worse place. A run from somewhere
        // else has no chat here, and then its words are all the panel can show — which is
        // the point of keeping them on the ticket.
        chatId={chatIds.includes(shown.id) ? shown.id : null}
        onOpenChat={onOpenChat}
      />

      {others.length > 0 && (
        <section {...stylex.props(styles.section)}>
          <Text type="label" weight="medium">
            Other runs
          </Text>
          <ul {...stylex.props(styles.lines)}>
            {others.map((each) => (
              <li key={each.id}>
                <Button
                  label={runChoiceLabel(each)}
                  size="sm"
                  variant="ghost"
                  onClick={() => setPicked(each.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * One run on a ticket: what it made, and where its words are.
 *
 * A run is a chat, so the words are read in the chat rather than drawn again here — this
 * window is holding that chat already, and a chat is a better place to read a conversation
 * than a panel beside a ticket is. What the panel keeps is the evidence: what the run
 * changed, what it ran, and where it stands, which is what a person decides on without
 * reading a whole conversation (GH #68).
 *
 * A run that happened somewhere else has no chat in this window, and then its words are
 * read from the server and drawn here — the transcript is project-owned, so a colleague's
 * run is still readable on the ticket. Those words are read when the ticket is opened and
 * again on the beat the queue is read on while the run is going, because a run that is
 * talking should be readable as it talks (GH #74).
 */
function RunReading({
  ticketId,
  run,
  chatId,
  onOpenChat,
}: {
  ticketId: string;
  run: TicketRun;
  /** The chat this run's words are in, when this window is holding it. */
  chatId: string | null;
  onOpenChat: (chatId: string) => void;
}) {
  const [said, setSaid] = useState<TicketSaid[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const read = useCallback(async () => {
    const answer = await window.foundry.readTranscript(ticketId, run.id);

    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }

    setTrouble(null);
    setSaid(answer.value);
  }, [ticketId, run.id]);

  useMountEffect(() => {
    void read();
  });

  // While the run is still going, its words are read again on the same beat as the queue:
  // a run says things as it works, and the ticket should not be a page somebody has to
  // reload to see them.
  const going = run.endedAt === null;

  useEffect(() => {
    if (!going) return;

    const beat = setInterval(() => void read(), READ_AGAIN_MS);

    return () => clearInterval(beat);
  }, [going, read]);

  return (
    <section {...stylex.props(styles.section)}>
      <Text type="label" weight="medium">
        The run
      </Text>
      <Text type="supporting" color="secondary">
        {runTelling(run)}
      </Text>

      {run.changed !== null && (
        <div {...stylex.props(styles.evidence)}>
          <Text type="supporting" color="secondary">
            What it changed
          </Text>
          <Text type="code">{run.changed}</Text>
        </div>
      )}

      {run.checks !== null && run.checks.length > 0 && (
        <div {...stylex.props(styles.evidence)}>
          <Text type="supporting" color="secondary">
            What it ran
          </Text>
          <ul {...stylex.props(styles.lines)}>
            {run.checks.map((each, at) => (
              <li key={`${at}-${each}`} {...stylex.props(styles.saidLine)}>
                <Text type="code">{each}</Text>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div {...stylex.props(styles.evidence)}>
        <Text type="supporting" color="secondary">
          What it said
        </Text>

        {chatId !== null ? (
          <div>
            <Button
              label="Read the run"
              icon={<Icon icon={TicketIcon} size="sm" />}
              size="sm"
              variant="secondary"
              onClick={() => onOpenChat(chatId)}
            />
          </div>
        ) : trouble !== null ? (
          <Text type="supporting" color="secondary">
            {trouble}
          </Text>
        ) : said === null ? (
          <Skeleton width="100%" height={16} />
        ) : said.length === 0 && run.made !== null ? (
          // Nothing was recorded while it went, which is what a run that only ever said one
          // thing looks like: its closing words are still what it had to say.
          <Text type="body" {...stylex.props(styles.saidWords)}>
            {run.made}
          </Text>
        ) : said.length === 0 ? (
          // An empty list would read as a run that had nothing to say. Words reach the
          // ticket as they settle, so a run that is still on its first turn has none here
          // yet — and that is a different thing from a run that said nothing at all.
          <Text type="supporting" color="secondary">
            {going ? 'Nothing yet — it is still working.' : 'It said nothing.'}
          </Text>
        ) : (
          <ul {...stylex.props(styles.said)}>
            {said.map((each, at) => (
              <li key={each.id} {...stylex.props(styles.saidLine)}>
                <Text type="supporting" color="secondary">
                  {saidByLabel(each.saidBy, at === 0)} · {when(each.at)}
                </Text>
                <Text type="body" {...stylex.props(styles.saidWords)}>
                  {each.words}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function NamedGlyph({ ticket }: { ticket: NamedTicket }) {
  const icon: LucideIcon = !ticket.closed
    ? Play
    : ticket.closure === 'wontfix'
      ? CircleAlert
      : CircleCheck;

  return (
    <span {...stylex.props(styles.glyph, ticket.closure === 'wontfix' && styles.glyphAbandoned)}>
      <Icon icon={icon} size="sm" />
    </span>
  );
}

/* ── Writing one down, and correcting it ────────────────────────────────── */

/**
 * The form, in the place a ticket is read.
 *
 * Four things and no more: what kind of work it is, what it is called, what to
 * build, and how it is known to be done. A ticket is written as a draft, so
 * nothing here insists on the criteria — a draft is what a ticket is before
 * anybody has said what it owes, and the refusal that matters comes when it is
 * marked ready for an agent, in the server's own words.
 */
function TicketForm({
  placement,
  refusal,
  trouble,
  onRetry,
  onLeave,
  onWrite,
}: {
  placement: 'inline' | 'over' | 'beside';
  refusal: string | null;
  trouble: string | null;
  onRetry: () => void;
  onLeave: () => void;
  onWrite: (draft: TicketDraft) => Promise<void>;
}) {
  const [kind, setKind] = useState<TicketKind>('feature');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [criteria, setCriteria] = useState<string[]>(['']);
  const [isBusy, setIsBusy] = useState(false);

  return (
    <TicketPanel
      placement={placement}
      onLeave={onLeave}
      refusal={refusal}
      head={
        <>
          <Text type="label" weight="medium">
            A new ticket
          </Text>
          <Text type="supporting" color="secondary">
            It lands among the drafts. Nothing is asked of an agent until you mark it ready.
          </Text>
        </>
      }
      foot={
        <>
          <Button
            label={isBusy ? 'Writing it down' : 'Write it down'}
            size="sm"
            variant="primary"
            isDisabled={isBusy}
            onClick={() => {
              setIsBusy(true);
              void onWrite({ kind, title, body, criteria }).finally(() => setIsBusy(false));
            }}
          />
          <Button label="Cancel" size="sm" variant="ghost" onClick={onLeave} />
        </>
      }
    >
      {trouble !== null && <QueueReadFailure trouble={trouble} onRetry={onRetry} />}
      <section {...stylex.props(styles.section)}>
        <Text type="label" weight="medium">
          What kind of work
        </Text>
        <div>
          <SegmentedControl
            value={kind}
            onChange={(next) => {
              if (isKind(next)) setKind(next);
            }}
            label="What kind of work this is"
            size="sm"
          >
            {KINDS.map((each) => (
              <SegmentedControlItem key={each} value={each} label={each} />
            ))}
          </SegmentedControl>
        </div>
        <Text type="supporting" color="secondary">
          The kind decides what a run of this ticket owes, and it is fixed once the ticket is
          written.
        </Text>
      </section>

      <div {...stylex.props(styles.formFields)}>
        <TextInput
          label="Title"
          value={title}
          onChange={setTitle}
          description="What it is called, in one line. A ticket's branch is named from it."
        />
        <TextArea
          label="What to build"
          value={body}
          onChange={setBody}
          description="Enough that whoever runs it needs nothing else to hand."
          rows={6}
        />
      </div>

      <section {...stylex.props(styles.section)}>
        <Text type="label" weight="medium">
          Acceptance criteria
        </Text>
        <Text type="supporting" color="secondary">
          One line each. An agent's ticket needs at least one that says something.
        </Text>
        <CriteriaFields criteria={criteria} onChange={setCriteria} />
      </section>
    </TicketPanel>
  );
}

/** Correcting what a ticket says, in the place it is read. */
function TicketEdit({
  ticket,
  isBusy,
  onSave,
  onCancel,
}: {
  ticket: Ticket;
  isBusy: boolean;
  onSave: (change: { title: string; body: string; criteria: string[] }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(ticket.title);
  const [body, setBody] = useState(ticket.body);
  const [criteria, setCriteria] = useState<string[]>(
    ticket.criteria.length === 0 ? [''] : ticket.criteria,
  );

  return (
    <div {...stylex.props(styles.formFields)}>
      <TextInput label="Title" value={title} onChange={setTitle} size="sm" />
      <TextArea label="What to build" value={body} onChange={setBody} rows={6} />
      <Text type="label" weight="medium">
        Acceptance criteria
      </Text>
      <CriteriaFields criteria={criteria} onChange={setCriteria} />
      <div {...stylex.props(styles.actions)}>
        <Button
          label="Save"
          size="sm"
          variant="primary"
          isDisabled={isBusy}
          onClick={() => onSave({ title, body, criteria })}
        />
        <Button label="Cancel" size="sm" variant="ghost" onClick={onCancel} />
      </div>
    </div>
  );
}

/** The criteria as they are edited: one line each, added and taken away. */
function CriteriaFields({
  criteria,
  onChange,
}: {
  criteria: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <>
      {criteria.map((line, at) => (
        <div key={at} {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.fieldGrow)}>
            <TextInput
              label={`Criterion ${at + 1}`}
              isLabelHidden
              value={line}
              onChange={(next) =>
                onChange(criteria.map((each, index) => (index === at ? next : each)))
              }
              size="sm"
            />
          </div>
          <IconButton
            label={`Take criterion ${at + 1} away`}
            icon={<Icon icon={X} size="sm" />}
            isDisabled={criteria.length === 1}
            onClick={() => onChange(criteria.filter((_each, index) => index !== at))}
          />
        </div>
      ))}
      <div>
        <Button
          label="Another criterion"
          icon={<Icon icon={Plus} size="sm" />}
          size="sm"
          variant="ghost"
          onClick={() => onChange([...criteria, ''])}
        />
      </div>
    </>
  );
}

/* ── Small helpers ──────────────────────────────────────────────────────── */

function isView(value: string): value is View {
  return VIEWS.some((each) => each.id === value);
}

function isKind(value: string): value is TicketKind {
  return KINDS.some((each) => each === value);
}

/** Which reading the window opens on, from `?view=` — Queue, because it explains itself. */
function readView(): View {
  const asked = new URLSearchParams(window.location.search).get('view') ?? '';

  return isView(asked) ? asked : 'queue';
}

/**
 * Copy the branch name, so a person can paste it into their own git client.
 *
 * The clipboard API is the way in, and it is not always there: a packaged window
 * is served from `file://`, which is not a secure context, so the older selection
 * route is kept as the way that always works.
 */
function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => {
    const held = document.createElement('textarea');
    held.value = text;
    document.body.append(held);
    held.select();
    document.execCommand('copy');
    held.remove();
  });
}
