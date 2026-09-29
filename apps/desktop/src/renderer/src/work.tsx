/**
 * The Work surface: one project's issues, on a board or in a list.
 *
 * Board and List are two readings of the same issues. Opening an issue puts the
 * same detail panel over either view, so its execution workspace stays close to
 * the plan without replacing the board or list.
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
 *
 * Ticket details lead with the purpose and finish line; operational context stays
 * close by, but behind a disclosure.
 */
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Item } from '@astryxdesign/core/Item';
import { List } from '@astryxdesign/core/List';
import { Selector } from '@astryxdesign/core/Selector';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  borderVars,
  colorVars,
  focusVars,
  shadowVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEventHandler,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Bug,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  Copy,
  FileText,
  FlaskConical,
  FolderOpen,
  GitBranch,
  GripVertical,
  History,
  Map as MapIcon,
  MessageSquare,
  Paperclip,
  Play,
  Plus,
  Rows3,
  Search,
  SlidersHorizontal,
  Sparkles,
  SquareKanban,
  Ticket as TicketIcon,
  Wrench,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  age,
  bandIcon,
  branchNote,
  holding,
  inBand,
  runChoiceLabel,
  runTelling,
  saidByLabel,
  suggestPrefix,
  when,
} from './workRows.ts';
import {
  canReorderReady,
  bandLabel,
  DEFAULT_WORK_DISPLAY,
  displayWork,
  groupedWork,
  planTicketDrop,
  readWorkDisplay,
  type WorkDisplay,
  type WorkGroup,
  type TicketDropPlan,
  reorderReady,
} from './workDisplay.ts';
import type {
  AuthState,
  Band,
  ChatSummary,
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
  ExecutionWorkspace,
  DeliveryAudit,
  DeliveryPath,
  Result,
  WorkspaceSummary,
} from '../../preload/bridge.ts';
import { ExecutionWorkspacePanel } from './executionWorkspace.tsx';

/** Two readings of the same issues. */
type View = 'board' | 'list';

interface DropIntent {
  ticketId: string;
  target: Band;
  plan: TicketDropPlan;
}

const VIEWS: { id: View; label: string; icon: LucideIcon; note: string }[] = [
  {
    id: 'board',
    label: 'Board',
    icon: SquareKanban,
    note: 'issues grouped by status',
  },
  {
    id: 'list',
    label: 'List',
    icon: Rows3,
    note: 'all issues in a list',
  },
];

/** The six server-derived lanes, ordered from the next human action to completed work. */
const BANDS: { id: Band; label: string; note: string }[] = [
  {
    id: 'needs-you',
    label: 'Needs review',
    note: 'a question or run result needs your answer',
  },
  {
    id: 'ready',
    label: 'Ready',
    note: 'ready for its next action',
  },
  { id: 'running', label: 'Running', note: 'someone is working on it now' },
  { id: 'blocked', label: 'Blocked', note: 'child work remains open or a breakdown is needed' },
  { id: 'draft', label: 'Drafts', note: 'captured, but not ready to run' },
  { id: 'done', label: 'Done', note: 'closed with a recorded outcome' },
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

/** Each kind's shape, drawn before its name on the board so kinds read apart at a glance. */
const KIND_ICON: Record<TicketKind, LucideIcon> = {
  prototype: FlaskConical,
  bug: Bug,
  feature: Sparkles,
  refactor: Wrench,
  question: CircleHelp,
  research: Search,
  spec: FileText,
  map: MapIcon,
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
    '@media (max-width: 760px)': {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
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
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    '@media (max-width: 760px)': {
      flexShrink: 1,
      minWidth: 0,
      justifyContent: 'flex-start',
    },
  },
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-1'],
    paddingBlock: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-4'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-background-muted'],
  },
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  listView: { position: 'relative' },
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
    position: 'relative',
    display: 'flex',
    flexDirection: 'row',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
  },
  boardColumns: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'stretch',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflowX: 'auto',
    overflowY: 'hidden',
    scrollSnapType: 'x proximity',
    scrollbarGutter: 'stable',
    scrollbarColor: `${colorVars['--color-accent-muted']} transparent`,
    '::-webkit-scrollbar-thumb': {
      backgroundColor: colorVars['--color-accent-muted'],
    },
    '::-webkit-scrollbar-thumb:hover': {
      backgroundColor: colorVars['--color-accent'],
    },
  },
  /* A lane is a ruled column: no box of its own, a hairline between it and the next. */
  column: {
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 296px',
    minWidth: 0,
    minHeight: 0,
    borderInlineEndWidth: borderVars['--border-width'],
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: colorVars['--color-border'],
    scrollSnapAlign: 'start',
    transitionProperty: 'background-color',
    transitionDuration: '160ms',
  },
  columnOver: { backgroundColor: colorVars['--color-overlay-hover'] },
  laneHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
    flexShrink: 0,
    paddingBlock: spacingVars['--spacing-3'],
    paddingInline: spacingVars['--spacing-4'],
    borderBlockEndWidth: 2,
    borderBlockEndStyle: 'solid',
  },
  laneNeedsYou: { borderBlockEndColor: colorVars['--color-warning'] },
  laneReady: { borderBlockEndColor: colorVars['--color-accent'] },
  laneRunning: { borderBlockEndColor: colorVars['--color-icon-blue'] },
  laneBlocked: { borderBlockEndColor: colorVars['--color-icon-orange'] },
  laneDraft: { borderBlockEndColor: colorVars['--color-border-emphasized'] },
  laneDone: { borderBlockEndColor: colorVars['--color-success'] },
  laneLabel: {
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: colorVars['--color-text-primary'],
  },
  laneCount: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  rows: {
    flex: '0 1 auto',
    minHeight: 0,
    margin: 0,
    padding: 0,
    listStyle: 'none',
    overflowY: 'auto',
    overscrollBehaviorY: 'contain',
  },
  laneEmpty: {
    margin: 0,
    paddingBlock: spacingVars['--spacing-3'],
    paddingInline: spacingVars['--spacing-4'],
    fontSize: '0.8125rem',
    color: colorVars['--color-text-secondary'],
  },

  /* A ticket on the board: one ruled row, its actions raised over it on hover or focus. */
  row: {
    '--row-reveal': { default: '0', ':hover': '1', ':focus-within': '1' },
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    paddingBlock: 10,
    paddingInline: spacingVars['--spacing-4'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
    backgroundColor: {
      default: 'transparent',
      ':hover': colorVars['--color-overlay-hover'],
    },
    touchAction: 'manipulation',
  },
  rowSelected: {
    backgroundColor: {
      default: colorVars['--color-accent-muted'],
      ':hover': colorVars['--color-accent-muted'],
    },
  },
  rowDragging: { opacity: 0.4 },
  rowOverlay: {
    width: 295,
    borderBlockEndWidth: 0,
    borderRadius: 6,
    backgroundColor: colorVars['--color-background-popover'],
    boxShadow: shadowVars['--shadow-med'],
    cursor: 'grabbing',
  },
  rowOpen: {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: '-2px',
  },
  rowTop: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minHeight: 22,
  },
  rowKind: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    color: colorVars['--color-icon-secondary'],
  },
  rowName: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    letterSpacing: '0.01em',
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  rowAge: {
    flex: 1,
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    whiteSpace: 'nowrap',
  },
  rowPerson: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 20,
    height: 20,
    borderRadius: 999,
    fontSize: textSizeVars['--font-size-xs'],
    fontWeight: 600,
    color: colorVars['--color-text-primary'],
    backgroundColor: colorVars['--color-neutral'],
    opacity: 'calc(1 - var(--row-reveal, 0))',
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
  },
  rowTitle: {
    fontSize: textSizeVars['--font-size-base'],
    fontWeight: 500,
    lineHeight: 1.4,
    color: colorVars['--color-text-primary'],
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    overflowWrap: 'anywhere',
  },
  rowState: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1-5'],
    minWidth: 0,
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  rowStateIcon: { display: 'inline-flex', alignItems: 'center', flexShrink: 0 },
  rowStateWords: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  toneNeedsYou: { color: colorVars['--color-text-yellow'] },
  toneReady: { color: colorVars['--color-text-accent'] },
  toneRunning: { color: colorVars['--color-text-blue'] },
  toneBlocked: { color: colorVars['--color-text-orange'] },
  toneDraft: { color: colorVars['--color-text-secondary'] },
  toneDone: { color: colorVars['--color-text-green'] },
  rowTags: { display: 'flex', flexWrap: 'wrap', gap: spacingVars['--spacing-1'] },
  rowTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height: 20,
    paddingInline: 6,
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: 999,
    backgroundColor: 'transparent',
    fontSize: '0.6875rem',
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  rowTagAttached: {
    borderColor: colorVars['--color-accent-muted'],
    color: colorVars['--color-text-accent'],
  },
  rowTagButton: {
    position: 'relative',
    zIndex: 1,
    cursor: 'pointer',
    borderColor: {
      default: colorVars['--color-border'],
      ':hover': colorVars['--color-border-emphasized'],
    },
    color: {
      default: colorVars['--color-text-secondary'],
      ':hover': colorVars['--color-text-primary'],
    },
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: 1,
  },
  kindDot: { width: 6, height: 6, borderRadius: 999, flexShrink: 0 },
  kindCyan: { backgroundColor: colorVars['--color-icon-cyan'] },
  kindOrange: { backgroundColor: colorVars['--color-icon-orange'] },
  kindPurple: { backgroundColor: colorVars['--color-icon-purple'] },
  kindTeal: { backgroundColor: colorVars['--color-icon-teal'] },
  kindPink: { backgroundColor: colorVars['--color-icon-pink'] },
  kindGray: { backgroundColor: colorVars['--color-icon-secondary'] },
  strip: {
    position: 'absolute',
    insetBlockStart: 6,
    insetInlineEnd: 12,
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: 2,
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: 6,
    backgroundColor: colorVars['--color-background-popover'],
    boxShadow: shadowVars['--shadow-low'],
    opacity: 'var(--row-reveal, 0)',
    transform: 'translateY(calc((1 - var(--row-reveal, 0)) * 3px))',
    transitionProperty: 'opacity, transform',
    transitionDuration: '140ms',
    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  stripStart: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height: 22,
    paddingInline: 7,
    borderWidth: 0,
    borderRadius: 4,
    backgroundColor: colorVars['--color-accent'],
    color: colorVars['--color-on-accent'],
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 600,
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: 1,
  },
  stripButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    padding: 0,
    borderWidth: 0,
    borderRadius: 4,
    backgroundColor: {
      default: 'transparent',
      ':hover': colorVars['--color-overlay-hover'],
    },
    color: {
      default: colorVars['--color-icon-secondary'],
      ':hover': colorVars['--color-text-primary'],
    },
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: 1,
  },
  stripOn: { color: colorVars['--color-text-accent'] },
  stripHandle: {
    cursor: { default: 'grab', ':active': 'grabbing' },
    touchAction: 'none',
  },
  dropAction: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-3'],
    flexWrap: 'wrap',
    paddingBlock: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-4'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-background-muted'],
    backgroundColor: colorVars['--color-background-surface'],
  },
  dropActionCopy: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-0-5'],
    minWidth: 200,
    flex: '1 1 240px',
  },
  dropActionTools: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    flexWrap: 'wrap',
  },
  dropSelector: {
    minWidth: 220,
    maxWidth: 320,
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
  boardDrawer: {
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 min(420px, 42vw)',
    minWidth: 320,
    minHeight: 0,
    backgroundColor: colorVars['--color-background-surface'],
    borderInlineStartWidth: borderVars['--border-width'],
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colorVars['--color-background-muted'],
    '@media (max-width: 920px)': {
      position: 'absolute',
      insetBlock: 0,
      insetInlineEnd: 0,
      width: 'min(460px, 94%)',
      flex: 'none',
      minWidth: 0,
      zIndex: 1,
    },
    '@media (max-width: 540px)': {
      width: '100%',
    },
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
    gap: spacingVars['--spacing-3'],
    flexShrink: 0,
    padding: spacingVars['--spacing-4'],
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
    width: '100%',
    boxSizing: 'border-box',
    overflowY: 'auto',
    padding: spacingVars['--spacing-4'],
    maxWidth: 860,
    marginInline: 'auto',
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
  ticketHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
  },
  ticketIdentity: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-2'],
  },
  ticketStatus: {
    display: 'inline-flex',
    alignItems: 'center',
    paddingBlock: spacingVars['--spacing-0-5'],
    paddingInline: spacingVars['--spacing-2'],
    borderRadius: 999,
    backgroundColor: colorVars['--color-background-muted'],
  },
  ticketTitle: {
    marginBlock: 0,
    color: colorVars['--color-text-primary'],
    fontFamily: 'inherit',
    fontSize: '1.375rem',
    fontWeight: 600,
    letterSpacing: '-0.025em',
    lineHeight: 1.25,
    overflowWrap: 'anywhere',
  },
  ticketBodyText: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.6,
  },
  ticketSectionHeading: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-3'],
  },
  ticketCriteria: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  ticketCriterion: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacingVars['--spacing-3'],
    minWidth: 0,
    paddingBlock: spacingVars['--spacing-2'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-background-muted'],
  },
  ticketCriterionIcon: {
    flexShrink: 0,
    marginBlockStart: 2,
    color: colorVars['--color-icon-accent'],
  },
  ticketCriterionText: {
    flex: 1,
    minWidth: 0,
    lineHeight: 1.5,
  },
  ticketDetails: {
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-background-muted'],
  },
  ticketDetailsSummary: {
    paddingBlock: spacingVars['--spacing-3'],
    color: colorVars['--color-text-primary'],
    cursor: 'pointer',
    ':focus-visible': {
      outlineWidth: focusVars['--focus-outline-width'],
      outlineStyle: focusVars['--focus-outline-style'],
      outlineColor: focusVars['--focus-outline-color'],
      outlineOffset: focusVars['--focus-outline-offset'],
    },
  },
  ticketDetailsSummaryText: {
    display: 'inline-flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-0-5'],
    marginInlineStart: spacingVars['--spacing-2'],
    verticalAlign: 'middle',
  },
  ticketDetailsContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-4'],
    paddingBlockEnd: spacingVars['--spacing-4'],
  },
  ticketFacts: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
  },
  ticketFact: {
    display: 'grid',
    gridTemplateColumns: 'minmax(88px, 0.7fr) minmax(0, 1.3fr)',
    alignItems: 'baseline',
    gap: spacingVars['--spacing-3'],
  },
  ticketFactValue: {
    minWidth: 0,
    overflowWrap: 'anywhere',
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
  chatSummaries,
  initialTicketId,
  onBack,
  onOpenChat,
  onStartChat,
  onJoined,
}: {
  /** The workspace whose project is being worked, or null when there is none. */
  workspace: WorkspaceSummary | null;
  /** Who is signed in, as the window last heard — null until the first answer. */
  auth: AuthState | null;
  /** The chats the window is holding, by id: a run's chat is one of them. */
  chatIds: string[];
  chatSummaries: ChatSummary[];
  /** A ticket to select when Work was opened from the shaping Workbench. */
  initialTicketId?: string | null;
  /** Return to the project navigator, when this surface was entered from there. */
  onBack?: () => void;
  /** Show a chat: what a run is, and where its words are read. */
  onOpenChat: (chatId: string) => void;
  /** Start an ordinary chat with selected tickets attached as working context. */
  onStartChat: (ticketIds: string[]) => void;
  /** A join happened, so the window can draw the link the folder now has. */
  onJoined: (workspace: WorkspaceSummary) => void;
}) {
  const [queue, setQueue] = useState<TicketQueue | null>(null);
  /** Why there is no queue, when there is none to draw. */
  const [trouble, setTrouble] = useState<string | null>(null);
  const [view, setView] = useState<View>(readView);
  const [openId, setOpenId] = useState<string | null>(initialTicketId ?? null);
  const [display, setDisplay] = useState<WorkDisplay>(() =>
    readWorkDisplay(window.location.search),
  );
  const [isWriting, setIsWriting] = useState(false);
  /** What the server last refused, in its own words. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
  const [executionWorkspaces, setExecutionWorkspaces] = useState<
    Record<string, ExecutionWorkspace[]>
  >({});
  const [dropIntent, setDropIntent] = useState<DropIntent | null>(null);
  const [dropExecutionWorkspaces, setDropExecutionWorkspaces] = useState<
    ExecutionWorkspace[] | null
  >(null);
  const [dropLoading, setDropLoading] = useState(false);
  const [dropBusy, setDropBusy] = useState(false);
  const dropRequestId = useRef(0);

  function updateDisplay(change: WorkDisplay | ((current: WorkDisplay) => WorkDisplay)): void {
    setDisplay((current: WorkDisplay) => {
      const next = typeof change === 'function' ? change(current) : change;
      const params = new URLSearchParams(window.location.search);
      const values: [string, string | null][] = [
        ['search', next.search.trim() || null],
        ['band', next.band === 'all' ? null : next.band],
        ['kind', next.kind === 'all' ? null : next.kind],
        ['claim', next.claim === 'all' ? null : next.claim],
        ['order', next.order === 'rank' ? null : next.order],
        ['group', next.group === 'status' ? null : next.group],
        ['done', next.showDone ? '1' : null],
      ];
      for (const [key, value] of values) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      window.history.replaceState(
        null,
        '',
        query ? `${window.location.pathname}?${query}` : window.location.pathname,
      );
      return next;
    });
  }

  const projectId = workspace?.projectId ?? null;

  // A chat's own read: one workspace's queue, asked for again by whoever needs it — the
  // mount, the window coming back, a write, and the beat while a run is going.
  const read = useCallback(async (): Promise<void> => {
    if (workspace === null || projectId === null) return;

    const answer = await window.kira.loadQueue(workspace.id);

    if (!answer.ok) {
      // Do not leave stale tickets in hand while the queue is unavailable. An open
      // form stays in the normal view branch, so its own draft remains mounted.
      setTrouble(answer.error);
      setQueue(null);
      return;
    }

    setTrouble(null);
    setQueue(answer.value);
    if (openId !== null) {
      const workspaces = await window.kira.listExecutionWorkspaces(openId);
      if (workspaces.ok) {
        setExecutionWorkspaces((current) => ({ ...current, [openId]: workspaces.value }));
      }
    }
  }, [workspace, projectId, openId]);

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

  /** Move a Ready ticket to the front of its existing lane without changing its gate. */
  async function promote(id: string): Promise<void> {
    const ready = tickets.filter((each) => each.band === 'ready' && each.id !== id);
    const top = ready.reduce(
      (lowest, each) => Math.min(lowest, each.rank),
      Number.MAX_SAFE_INTEGER,
    );

    await wrote(() =>
      window.kira.changeTicket(id, {
        rank: top === Number.MAX_SAFE_INTEGER ? 0 : top - 1,
      }),
    );
  }

  async function reorder(activeId: string, overId: string): Promise<void> {
    const ordered = reorderReady(tickets, activeId, overId);
    if (ordered.length < 2 || ordered.findIndex((each) => each.id === activeId) < 0) return;

    for (const [rank, ticket] of ordered.entries()) {
      const answer = await window.kira.changeTicket(ticket.id, { rank });
      if (!answer.ok) {
        setRefusal(answer.error);
        await read();
        return;
      }
    }

    setRefusal(null);
    await read();
  }

  function beginTicketDrop(ticketId: string, target: Band): void {
    const requestId = ++dropRequestId.current;
    const ticket = queue?.tickets.find((each) => each.id === ticketId);
    if (ticket === undefined) return;

    const plan = planTicketDrop(ticket, target);
    if (plan === null) return;

    setDropIntent({ ticketId, target, plan });
    setDropExecutionWorkspaces(null);
    setDropLoading(false);
    setDropBusy(false);
    setRefusal(null);

    if (plan.kind !== 'start-run') return;

    setDropLoading(true);
    void window.kira
      .listExecutionWorkspaces(ticketId)
      .then((answer) => {
        if (requestId !== dropRequestId.current) return;
        setDropLoading(false);
        if (!answer.ok) {
          setRefusal(answer.error);
          return;
        }
        setDropExecutionWorkspaces(answer.value);
      })
      .catch((failure: unknown) => {
        if (requestId !== dropRequestId.current) return;
        setDropLoading(false);
        setRefusal(failure instanceof Error ? failure.message : String(failure));
      });
  }

  function cancelTicketDrop(): void {
    dropRequestId.current += 1;
    setDropIntent(null);
  }

  async function applyDropWrite(
    action: () => Promise<{ ok: true; value: Ticket } | { ok: false; error: string }>,
  ): Promise<void> {
    setDropBusy(true);
    const changed = await wrote(action);
    setDropBusy(false);
    if (changed !== null) setDropIntent(null);
  }

  async function applyDropVerdict(verdict: 'accepted' | 'sent-back'): Promise<void> {
    const ticket = tickets.find((each) => each.id === dropIntent?.ticketId);
    if (ticket === undefined || workspace === null) return;
    const run = ticket.runs[0];
    if (run === undefined) return;

    setDropBusy(true);
    const judged = await acted(() =>
      window.kira.judgeRun(ticket.id, run.id, verdict, workspace.id),
    );
    setDropBusy(false);
    if (judged) setDropIntent(null);
  }

  async function applyDropRun(executionWorkspaceId: string): Promise<void> {
    const ticket = tickets.find((each) => each.id === dropIntent?.ticketId);
    if (ticket === undefined || workspace === null) return;

    setDropBusy(true);
    const started = await acted(() =>
      window.kira.startRun(workspace.id, ticket.id, executionWorkspaceId),
    );
    setDropBusy(false);
    if (started) setDropIntent(null);
  }

  async function removeDropBlocker(blockerId: string): Promise<void> {
    const ticket = tickets.find((each) => each.id === dropIntent?.ticketId);
    if (ticket === undefined) return;

    setDropBusy(true);
    const removed = await wrote(() => window.kira.ungateTicket(ticket.id, blockerId));
    setDropBusy(false);
    if (removed !== null) setDropIntent(null);
  }

  if (workspace === null) {
    return (
      <div {...stylex.props(styles.root)}>
        <div {...stylex.props(styles.scroll)}>
          <EmptyState
            title="No workspace selected"
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
  const visibleTickets = displayWork(tickets, display);
  const doneCount = displayWork(tickets, { ...display, showDone: true }).filter(
    (ticket) => ticket.band === 'done',
  ).length;
  const visibleBands = BANDS;
  const readyCanReorder = canReorderReady(display);
  const open = tickets.find((each) => each.id === openId) ?? null;
  const placement = view === 'board' ? 'beside' : 'over';
  const closePanel = (): void => {
    setIsWriting(false);
    setOpenId(null);
    setRefusal(null);
  };
  const openTicket = (id: string): void => {
    cancelTicketDrop();
    setIsWriting(false);
    setOpenId(id);
  };
  const panel = isWriting ? (
    <TicketForm
      placement={placement}
      refusal={refusal}
      trouble={trouble}
      onRetry={() => void read()}
      onLeave={closePanel}
      onWrite={async (draft) => {
        const written = await wrote(() => window.kira.writeTicket(workspace.id, draft));
        if (written !== null) {
          setIsWriting(false);
          setOpenId(written.id);
        }
      }}
    />
  ) : open === null ? null : (
    <TicketReading
      ticket={open}
      repository={workspace.folder}
      executionWorkspaces={executionWorkspaces[open.id] ?? []}
      placement={placement}
      refusal={refusal}
      chatIds={chatIds}
      onLeave={closePanel}
      onOpen={openTicket}
      onOpenChat={onOpenChat}
      onChanged={read}
      onRefuse={setRefusal}
      onWrite={(change) => wrote(() => window.kira.changeTicket(open.id, change))}
      onGate={(gatedBy) => wrote(() => window.kira.gateTicket(open.id, gatedBy))}
      onUngate={(gatedBy) => wrote(() => window.kira.ungateTicket(open.id, gatedBy))}
      onRun={(executionWorkspaceId, followUp) =>
        acted(() => window.kira.startRun(workspace.id, open.id, executionWorkspaceId, followUp))
      }
      onRequestRun={() => beginTicketDrop(open.id, 'running')}
      onDeliver={(workspaceId, path) =>
        window.kira.deliverExecutionWorkspace(open.id, workspaceId, path)
      }
      onQuestion={() => acted(() => window.kira.openQuestion(workspace.id, open.id))}
      onTakeOver={() => acted(() => window.kira.takeOverClaim(open.id))}
      onLetGo={() => acted(() => window.kira.releaseClaim(open.id))}
      onResolve={() =>
        acted(() =>
          window.kira.resolveRun(
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
          : acted(() => window.kira.judgeRun(open.id, last.id, verdict, workspace.id));
      }}
    />
  );

  return (
    <div role="presentation" {...stylex.props(styles.root)}>
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
              cancelTicketDrop();
              setView(next);
              setRefusal(null);
              const params = new URLSearchParams(window.location.search);
              params.set('view', next);
              const query = params.toString();
              window.history.replaceState(
                null,
                '',
                query ? `${window.location.pathname}?${query}` : window.location.pathname,
              );
            }}
            label="Issue view"
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
          <TextInput
            label="Search issues"
            isLabelHidden
            size="sm"
            width={190}
            value={display.search}
            placeholder="Search issues"
            isDisabled={queue === null}
            disabledMessage={trouble === null ? 'Work is loading.' : undefined}
            onChange={(next) => updateDisplay((current) => ({ ...current, search: next }))}
          />
          <Button
            label={filtersOpen ? 'Hide filters' : 'Filters'}
            icon={<Icon icon={SlidersHorizontal} size="sm" />}
            size="sm"
            variant={filtersOpen ? 'secondary' : 'ghost'}
            onClick={() => setFiltersOpen((open) => !open)}
          />
          <Button
            label="New issue"
            icon={<Icon icon={Plus} size="sm" />}
            variant="primary"
            size="sm"
            onClick={() => {
              setOpenId(null);
              setIsWriting(true);
              setRefusal(null);
            }}
          />
          {view === 'board' && attachedIds.length > 0 && (
            <Button
              label={`Start chat with ${attachedIds.length} ${attachedIds.length === 1 ? 'issue' : 'issues'}`}
              icon={<Icon icon={TicketIcon} size="sm" />}
              variant="primary"
              size="sm"
              onClick={() => onStartChat(attachedIds)}
            />
          )}
        </div>
      </div>

      {filtersOpen && (
        <div {...stylex.props(styles.filterBar)} aria-label="Issue filters">
          <Button
            label={`Status: ${display.band === 'all' ? 'all' : BANDS.find((each) => each.id === display.band)?.label}`}
            size="sm"
            variant="ghost"
            onClick={() =>
              updateDisplay((current) => {
                const index =
                  current.band === 'all' ? -1 : BANDS.findIndex((each) => each.id === current.band);
                const next = index >= BANDS.length - 1 ? 'all' : (BANDS[index + 1]?.id ?? 'all');
                return { ...current, band: next };
              })
            }
          />
          <Button
            label={`Kind: ${display.kind === 'all' ? 'all' : display.kind}`}
            size="sm"
            variant="ghost"
            onClick={() =>
              updateDisplay((current) => {
                const index = current.kind === 'all' ? -1 : KINDS.indexOf(current.kind);
                return {
                  ...current,
                  kind: index >= KINDS.length - 1 ? 'all' : (KINDS[index + 1] ?? 'all'),
                };
              })
            }
          />
          <Button
            label={`Claim: ${display.claim}`}
            size="sm"
            variant="ghost"
            onClick={() =>
              updateDisplay((current) => ({
                ...current,
                claim:
                  current.claim === 'all'
                    ? 'claimed'
                    : current.claim === 'claimed'
                      ? 'unclaimed'
                      : 'all',
              }))
            }
          />
          <Button
            label={display.group === 'status' ? 'Group: status' : 'Group: kind'}
            size="sm"
            variant="ghost"
            onClick={() =>
              updateDisplay((current) => ({
                ...current,
                group: current.group === 'status' ? 'kind' : 'status',
              }))
            }
          />
          <Button
            label={display.order === 'rank' ? 'Order: priority' : `Order: ${display.order}`}
            size="sm"
            variant="ghost"
            onClick={() =>
              updateDisplay((current) => ({
                ...current,
                order:
                  current.order === 'rank'
                    ? 'updated'
                    : current.order === 'updated'
                      ? 'created'
                      : 'rank',
              }))
            }
          />
          <Button
            label={display.showDone ? 'Hide done' : 'Show done'}
            size="sm"
            variant="ghost"
            onClick={() =>
              updateDisplay((current) => ({ ...current, showDone: !current.showDone }))
            }
          />
          <Button
            label="Clear filters"
            size="sm"
            variant="ghost"
            onClick={() => updateDisplay(DEFAULT_WORK_DISPLAY)}
          />
        </div>
      )}

      {view === 'board' && dropIntent !== null && (
        <DropActionBar
          intent={dropIntent}
          ticket={tickets.find((each) => each.id === dropIntent.ticketId) ?? null}
          tickets={tickets}
          executionWorkspaces={dropExecutionWorkspaces}
          isLoading={dropLoading}
          isBusy={dropBusy}
          refusal={refusal}
          onCancel={cancelTicketDrop}
          onOpen={openTicket}
          onChangeTicket={(ticketId, change) =>
            applyDropWrite(() => window.kira.changeTicket(ticketId, change))
          }
          onAddBlocker={(ticketId, blockerId) =>
            applyDropWrite(() => window.kira.gateTicket(ticketId, blockerId))
          }
          onRemoveBlocker={removeDropBlocker}
          onJudge={applyDropVerdict}
          onStartRun={applyDropRun}
        />
      )}

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
            title="No issues yet"
            description="Create an issue to plan work, start an agent workspace, and review the result."
            icon={<Icon icon={FileText} size="lg" />}
            headingLevel={2}
            actions={
              <Button
                label="New issue"
                icon={<Icon icon={Plus} size="sm" />}
                variant="primary"
                onClick={() => setIsWriting(true)}
              />
            }
          />
        </div>
      ) : visibleTickets.length === 0 && !isWriting ? (
        <div {...stylex.props(styles.scroll)}>
          <EmptyState
            title="No matching issues"
            description="Try a different search or clear the current filters."
            icon={<Icon icon={FileText} size="lg" />}
            headingLevel={2}
            actions={
              <Button
                label="Clear filters"
                variant="primary"
                onClick={() => updateDisplay(DEFAULT_WORK_DISPLAY)}
              />
            }
          />
        </div>
      ) : view === 'board' ? (
        <BoardView
          tickets={visibleTickets}
          bands={visibleBands}
          showDone={display.showDone}
          doneCount={doneCount}
          selected={openId}
          onOpen={openTicket}
          onPromote={(id) => void promote(id)}
          canReorder={readyCanReorder}
          onReorder={(activeId, overId) => void reorder(activeId, overId)}
          onDrop={beginTicketDrop}
          panel={panel}
          attachedIds={attachedIds}
          chatSummaries={chatSummaries}
          onOpenChat={onOpenChat}
          onToggleAttached={(id) =>
            setAttachedIds((current) =>
              current.includes(id) ? current.filter((each) => each !== id) : [...current, id],
            )
          }
        />
      ) : (
        <QueueView
          tickets={visibleTickets}
          bands={visibleBands}
          group={display.group}
          selected={openId}
          onOpen={openTicket}
          panel={panel}
          onLeave={closePanel}
        />
      )}
    </div>
  );
}

function QueueReadFailure({ trouble, onRetry }: { trouble: string; onRetry: () => void }) {
  return (
    <div {...stylex.props(styles.refusal)}>
      <Banner
        status="error"
        title="Could not load work"
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
    const answer = await window.kira.joinableProjects();
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
    const answer = await window.kira.joinWorkspace(workspace.id, request);
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
              title="Kira could not answer"
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
                      description={`${each.prefix} · issues are named ${each.prefix}-1, ${each.prefix}-2`}
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
                    description="Two to six letters and digits. Issue names use this prefix, which cannot change later."
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

function QueueView({
  tickets,
  bands,
  group,
  onOpen,
  panel,
  onLeave,
}: ViewProps & { bands: typeof BANDS; group: WorkGroup; onLeave: () => void }) {
  const content =
    group === 'kind' ? (
      <>
        {groupedWork(tickets, 'kind').map((section) => (
          <div key={section.key}>
            <div {...stylex.props(styles.bandHead)}>
              <Text type="label" weight="medium">
                {section.label}{' '}
                <span {...stylex.props(styles.count)}>{section.tickets.length}</span>
              </Text>
            </div>
            <List density="compact" hasDividers>
              {section.tickets.map((ticket) => (
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
                      <Holding ticket={ticket} />
                    </span>
                  }
                  onClick={() => onOpen(ticket.id)}
                />
              ))}
            </List>
          </div>
        ))}
      </>
    ) : (
      <>
        {bands.map((band) => (
          <Band key={band.id} band={band} tickets={inBand(tickets, band.id)} onOpen={onOpen} />
        ))}
      </>
    );

  return (
    <div {...stylex.props(styles.scroll, styles.listView)}>
      {content}
      {panel !== null && <IssueDrawer panel={panel} onLeave={onLeave} />}
    </div>
  );
}

function IssueDrawer({ panel, onLeave }: { panel: ReactNode; onLeave: () => void }) {
  return (
    <>
      <button
        type="button"
        aria-label="Close the issue"
        {...stylex.props(styles.scrim)}
        onClick={onLeave}
      />
      <div {...stylex.props(styles.drawer)}>{panel}</div>
    </>
  );
}

function DropActionBar({
  intent,
  ticket,
  tickets,
  executionWorkspaces,
  isLoading,
  isBusy,
  refusal,
  onCancel,
  onOpen,
  onChangeTicket,
  onAddBlocker,
  onRemoveBlocker,
  onJudge,
  onStartRun,
}: {
  intent: DropIntent;
  ticket: Ticket | null;
  tickets: Ticket[];
  executionWorkspaces: ExecutionWorkspace[] | null;
  isLoading: boolean;
  isBusy: boolean;
  refusal: string | null;
  onCancel: () => void;
  onOpen: (id: string) => void;
  onChangeTicket: (ticketId: string, change: TicketChange) => Promise<void>;
  onAddBlocker: (ticketId: string, blockerId: string) => Promise<void>;
  onRemoveBlocker: (blockerId: string) => Promise<void>;
  onJudge: (verdict: 'accepted' | 'sent-back') => Promise<void>;
  onStartRun: (executionWorkspaceId: string) => Promise<void>;
}) {
  const [selectedBlockerId, setSelectedBlockerId] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');

  if (ticket === null) return null;

  const blockerIds = new Set(ticket.children.map((child) => child.id));
  const addableBlockers = tickets.filter(
    (candidate) =>
      candidate.id !== ticket.id && candidate.closedAt === null && !blockerIds.has(candidate.id),
  );
  const openBlockers = ticket.children.filter((child) => !child.closed);
  const workspaces = executionWorkspaces ?? [];
  const chosenBlocker = addableBlockers.find((each) => each.id === selectedBlockerId);
  const chosenOpenBlocker = openBlockers.find((each) => each.id === selectedBlockerId);
  const chosenWorkspace =
    workspaces.find((each) => each.id === selectedWorkspaceId) ?? workspaces[0];
  const destination = bandLabel(intent.target);

  let message = `Move ${ticket.name} from ${bandLabel(ticket.band)} to ${destination}.`;
  if (intent.plan.kind === 'choose-ready-gate') {
    message = `Choose who should take the next turn on ${ticket.name}.`;
  } else if (intent.plan.kind === 'change-gate') {
    message = `Put ${ticket.name} back in Draft. Its blockers and run history will stay.`;
  } else if (intent.plan.kind === 'prepare-agent-run') {
    message = `${ticket.name} needs an agent-ready gate before a run can start.`;
  } else if (intent.plan.kind === 'start-run') {
    message = `Confirm the execution workspace for ${ticket.name}, then start its agent.`;
  } else if (intent.plan.kind === 'add-blocker') {
    message = `Choose an open issue that should block ${ticket.name}.`;
  } else if (intent.plan.kind === 'resolve-blockers') {
    message = `Remove an open dependency link from ${ticket.name}.`;
  } else if (intent.plan.kind === 'send-back') {
    message = `Send ${ticket.name}’s run proposal back for another attempt?`;
  } else if (intent.plan.kind === 'accept-result') {
    message = `Accept ${ticket.name}’s run proposal and close the ticket?`;
  } else if (intent.plan.kind === 'choose-closure') {
    message = `Choose how to close ${ticket.name}.`;
  } else if (intent.plan.kind === 'unavailable') {
    message = intent.plan.reason;
  }

  return (
    <section
      {...stylex.props(styles.dropAction)}
      aria-label="Confirm lane action"
      aria-live="polite"
    >
      <div {...stylex.props(styles.dropActionCopy)}>
        <Text type="label" weight="medium">
          {ticket.name} → {destination}
        </Text>
        <Text type="supporting" color="secondary">
          {message}
        </Text>
        {refusal !== null && (
          <Text type="supporting" color="secondary">
            {refusal}
          </Text>
        )}
      </div>
      <div {...stylex.props(styles.dropActionTools)}>
        {intent.plan.kind === 'choose-ready-gate' && (
          <>
            <Button
              label="Ready for an agent"
              size="sm"
              variant="primary"
              isDisabled={isBusy || !ticket.criteria.some((criterion) => criterion.trim() !== '')}
              onClick={() => void onChangeTicket(ticket.id, { gate: 'ready-for-agent' })}
            />
            <Button
              label="Ready for a person"
              size="sm"
              variant="secondary"
              isDisabled={isBusy}
              onClick={() => void onChangeTicket(ticket.id, { gate: 'ready-for-human' })}
            />
          </>
        )}
        {intent.plan.kind === 'change-gate' && (
          <Button
            label="Move to Draft"
            size="sm"
            variant="primary"
            isDisabled={isBusy}
            onClick={() => void onChangeTicket(ticket.id, { gate: 'draft' })}
          />
        )}
        {intent.plan.kind === 'prepare-agent-run' && (
          <Button
            label="Make agent-ready"
            size="sm"
            variant="primary"
            isDisabled={isBusy}
            onClick={() => void onChangeTicket(ticket.id, { gate: 'ready-for-agent' })}
          />
        )}
        {intent.plan.kind === 'start-run' &&
          (isLoading ? (
            <Text type="supporting" color="secondary">
              Checking execution workspaces…
            </Text>
          ) : workspaces.length === 0 ? (
            <Button
              label="Open issue to create an execution workspace"
              size="sm"
              variant="primary"
              isDisabled={isBusy || executionWorkspaces === null}
              onClick={() => onOpen(ticket.id)}
            />
          ) : (
            <>
              {workspaces.length > 1 && (
                <div {...stylex.props(styles.dropSelector)}>
                  <Selector
                    label="Execution workspace"
                    options={workspaces.map((each) => ({
                      value: each.id,
                      label: each.branch,
                      description: each.repository,
                    }))}
                    value={chosenWorkspace?.id}
                    onChange={setSelectedWorkspaceId}
                    isDisabled={isBusy}
                  />
                </div>
              )}
              <Button
                label={`Start agent${chosenWorkspace === undefined ? '' : ` in ${chosenWorkspace.branch}`}`}
                size="sm"
                variant="primary"
                isDisabled={isBusy || chosenWorkspace === undefined}
                onClick={() => {
                  if (chosenWorkspace !== undefined) void onStartRun(chosenWorkspace.id);
                }}
              />
            </>
          ))}
        {intent.plan.kind === 'add-blocker' && (
          <>
            {addableBlockers.length > 0 ? (
              <>
                <div {...stylex.props(styles.dropSelector)}>
                  <Selector
                    label="Blocking issue"
                    options={addableBlockers.map((each) => ({
                      value: each.id,
                      label: `${each.name} · ${each.title || 'Untitled'}`,
                    }))}
                    value={chosenBlocker?.id}
                    onChange={setSelectedBlockerId}
                    isDisabled={isBusy}
                  />
                </div>
                <Button
                  label="Add blocker"
                  size="sm"
                  variant="primary"
                  isDisabled={isBusy || chosenBlocker === undefined}
                  onClick={() => {
                    if (chosenBlocker !== undefined) {
                      void onAddBlocker(ticket.id, chosenBlocker.id);
                    }
                  }}
                />
              </>
            ) : (
              <Text type="supporting" color="secondary">
                No open issues can block this ticket.
              </Text>
            )}
          </>
        )}
        {intent.plan.kind === 'resolve-blockers' && (
          <>
            {openBlockers.length > 0 ? (
              <>
                <div {...stylex.props(styles.dropSelector)}>
                  <Selector
                    label="Open blocker"
                    options={openBlockers.map((each) => ({ value: each.id, label: each.name }))}
                    value={chosenOpenBlocker?.id}
                    onChange={setSelectedBlockerId}
                    isDisabled={isBusy}
                  />
                </div>
                <Button
                  label="Remove dependency"
                  size="sm"
                  variant="primary"
                  isDisabled={isBusy || chosenOpenBlocker === undefined}
                  onClick={() => {
                    if (chosenOpenBlocker !== undefined) {
                      void onRemoveBlocker(chosenOpenBlocker.id);
                    }
                  }}
                />
              </>
            ) : (
              <Text type="supporting" color="secondary">
                No open dependency links remain.
              </Text>
            )}
          </>
        )}
        {intent.plan.kind === 'send-back' && (
          <Button
            label="Send back to Ready"
            size="sm"
            variant="primary"
            isDisabled={isBusy}
            onClick={() => void onJudge('sent-back')}
          />
        )}
        {intent.plan.kind === 'accept-result' && (
          <Button
            label="Accept and close"
            size="sm"
            variant="primary"
            isDisabled={isBusy}
            onClick={() => void onJudge('accepted')}
          />
        )}
        {intent.plan.kind === 'choose-closure' && (
          <>
            <Button
              label="Close as done"
              size="sm"
              variant="primary"
              isDisabled={isBusy}
              onClick={() => void onChangeTicket(ticket.id, { closure: 'done' })}
            />
            <Button
              label="Not doing"
              size="sm"
              variant="secondary"
              isDisabled={isBusy}
              onClick={() => void onChangeTicket(ticket.id, { closure: 'wontfix' })}
            />
          </>
        )}
        {intent.plan.kind === 'unavailable' && (
          <Button
            label="Open issue"
            size="sm"
            variant="secondary"
            onClick={() => onOpen(ticket.id)}
          />
        )}
        <Button label="Cancel" size="sm" variant="ghost" isDisabled={isBusy} onClick={onCancel} />
      </div>
    </section>
  );
}

function BoardView({
  tickets,
  bands,
  showDone,
  doneCount,
  selected,
  onOpen,
  onPromote,
  canReorder,
  onReorder,
  onDrop,
  panel,
  attachedIds,
  chatSummaries,
  onOpenChat,
  onToggleAttached,
}: ViewProps & {
  bands: typeof BANDS;
  showDone: boolean;
  doneCount: number;
  onPromote: (id: string) => void;
  canReorder: boolean;
  onReorder: (activeId: string, overId: string) => void;
  onDrop: (ticketId: string, target: Band) => void;
  attachedIds: string[];
  chatSummaries: ChatSummary[];
  onOpenChat: (chatId: string) => void;
  onToggleAttached: (id: string) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragging = tickets.find((ticket) => ticket.id === draggingId) ?? null;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    setDraggingId(null);
    if (over === null || active.id === over.id) return;
    const activeTicket = tickets.find((ticket) => ticket.id === active.id);
    if (activeTicket === undefined) return;

    const overId = String(over.id);
    const targetBand = overId.startsWith('lane:')
      ? bands.find((band) => band.id === overId.slice('lane:'.length))?.id
      : tickets.find((ticket) => ticket.id === overId)?.band;
    if (targetBand === undefined) return;

    if (activeTicket.band === targetBand) {
      if (canReorder && targetBand === 'ready') onReorder(String(active.id), overId);
      return;
    }

    onDrop(activeTicket.id, targetBand);
  };
  const chatsFor = (ticket: Ticket): ChatSummary[] =>
    chatSummaries.filter((chat) => chat.workTicketIds.includes(ticket.id));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => setDraggingId(String(active.id))}
      onDragCancel={() => setDraggingId(null)}
      onDragEnd={handleDragEnd}
    >
      <div {...stylex.props(styles.board)}>
        <section
          aria-label="Issue lanes; scroll horizontally to see all states"
          {...stylex.props(styles.boardColumns)}
        >
          {bands.map((band) => {
            const held = inBand(tickets, band.id);
            return (
              <BoardLane
                key={band.id}
                band={band}
                tickets={held}
                showDone={showDone}
                count={band.id === 'done' && !showDone ? doneCount : held.length}
                selected={selected}
                canReorder={canReorder && band.id === 'ready'}
                onOpen={onOpen}
                onPromote={onPromote}
                onRequestRun={(ticketId) => onDrop(ticketId, 'running')}
                attachedIds={attachedIds}
                onToggleAttached={onToggleAttached}
                chatsFor={chatsFor}
                onOpenChat={onOpenChat}
              />
            );
          })}
        </section>
        {panel !== null && <div {...stylex.props(styles.boardDrawer)}>{panel}</div>}
      </div>
      {/* The row being dragged is drawn above every lane, so it can leave the one it
          scrolls in; the row it came from stays behind, faded, until the drop. */}
      <DragOverlay dropAnimation={null}>
        {dragging !== null && (
          <div {...stylex.props(styles.row, styles.rowOverlay)}>
            <TicketRowBody
              ticket={dragging}
              attached={attachedIds.includes(dragging.id)}
              linkedChats={chatsFor(dragging)}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

const LANE_RULE = {
  'needs-you': styles.laneNeedsYou,
  ready: styles.laneReady,
  running: styles.laneRunning,
  blocked: styles.laneBlocked,
  draft: styles.laneDraft,
  done: styles.laneDone,
} satisfies Record<Band, stylex.StyleXStyles>;

const BAND_TONE = {
  'needs-you': styles.toneNeedsYou,
  ready: styles.toneReady,
  running: styles.toneRunning,
  blocked: styles.toneBlocked,
  draft: styles.toneDraft,
  done: styles.toneDone,
} satisfies Record<Band, stylex.StyleXStyles>;

/**
 * A kind's hue on its tag. Hues no lane uses for status, except bug's orange; kinds that
 * share a hue are told apart by the shape before their name.
 */
const KIND_HUE = {
  feature: styles.kindCyan,
  bug: styles.kindOrange,
  refactor: styles.kindPurple,
  prototype: styles.kindTeal,
  question: styles.kindGray,
  research: styles.kindGray,
  spec: styles.kindPink,
  map: styles.kindPink,
} satisfies Record<TicketKind, stylex.StyleXStyles>;

function BoardLane({
  band,
  tickets,
  showDone,
  count,
  selected,
  canReorder,
  onOpen,
  onPromote,
  onRequestRun,
  attachedIds,
  onToggleAttached,
  chatsFor,
  onOpenChat,
}: {
  band: (typeof BANDS)[number];
  tickets: Ticket[];
  showDone: boolean;
  count: number;
  selected: string | null;
  canReorder: boolean;
  onOpen: (id: string) => void;
  onPromote: (id: string) => void;
  onRequestRun: (id: string) => void;
  attachedIds: string[];
  onToggleAttached: (id: string) => void;
  chatsFor: (ticket: Ticket) => ChatSummary[];
  onOpenChat: (chatId: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `lane:${band.id}` });

  return (
    <div ref={setNodeRef} {...stylex.props(styles.column, isOver && styles.columnOver)}>
      <header title={band.note} {...stylex.props(styles.laneHead, LANE_RULE[band.id])}>
        <span {...stylex.props(styles.laneLabel)}>{band.label}</span>
        <span {...stylex.props(styles.laneCount)}>{String(count).padStart(2, '0')}</span>
      </header>
      <ol aria-label={band.label} {...stylex.props(styles.rows)}>
        <SortableContext
          items={tickets.map((ticket) => ticket.id)}
          strategy={verticalListSortingStrategy}
        >
          {tickets.map((ticket) => (
            <SortableTicketRow
              key={ticket.id}
              ticket={ticket}
              selected={ticket.id === selected}
              canReorder={canReorder}
              onOpen={onOpen}
              onPromote={onPromote}
              onRequestRun={onRequestRun}
              attached={attachedIds.includes(ticket.id)}
              onToggleAttached={onToggleAttached}
              linkedChats={chatsFor(ticket)}
              onOpenChat={onOpenChat}
            />
          ))}
        </SortableContext>
      </ol>
      {tickets.length === 0 && (
        <p {...stylex.props(styles.laneEmpty)}>
          {band.id === 'done' && !showDone
            ? 'Done tickets are hidden in Filters.'
            : 'Nothing here.'}
        </p>
      )}
    </div>
  );
}

/**
 * One ticket on the board. The whole row opens it and can be dragged by pointer; the
 * handle in its action strip is the keyboard's way to move it, because Enter and Space on
 * the row belong to opening it.
 */
function SortableTicketRow({
  ticket,
  selected,
  canReorder,
  onOpen,
  onPromote,
  onRequestRun,
  attached,
  onToggleAttached,
  linkedChats,
  onOpenChat,
}: {
  ticket: Ticket;
  selected: boolean;
  canReorder: boolean;
  onOpen: (id: string) => void;
  onPromote: (id: string) => void;
  onRequestRun: (id: string) => void;
  attached: boolean;
  onToggleAttached: (id: string) => void;
  linkedChats: ChatSummary[];
  onOpenChat: (chatId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: ticket.id });
  const transformStyle =
    transform === null ? undefined : `translate3d(${transform.x}px, ${transform.y}px, 0)`;
  const canStart = planTicketDrop(ticket, 'running')?.kind === 'start-run';

  return (
    <li
      ref={setNodeRef}
      style={{ transform: transformStyle, transition }}
      onPointerDown={listeners?.onPointerDown as PointerEventHandler<HTMLLIElement> | undefined}
      {...stylex.props(
        styles.row,
        selected && styles.rowSelected,
        isDragging && styles.rowDragging,
      )}
    >
      <button
        type="button"
        aria-label={`Open issue ${ticket.name}: ${ticket.title || 'Untitled'}`}
        aria-current={selected || undefined}
        {...stylex.props(styles.rowOpen)}
        onClick={() => onOpen(ticket.id)}
      />
      <TicketRowBody
        ticket={ticket}
        attached={attached}
        linkedChats={linkedChats}
        onOpenChat={onOpenChat}
      />
      <span {...stylex.props(styles.strip)}>
        {canStart && (
          <button
            type="button"
            aria-label={`Start agent on ${ticket.name}`}
            {...stylex.props(styles.stripStart)}
            onClick={() => onRequestRun(ticket.id)}
          >
            <Icon icon={Play} size="xsm" />
            Start
          </button>
        )}
        {ticket.band === 'ready' && (
          <StripButton
            label={`Move issue ${ticket.name} to the front of Ready`}
            icon={ArrowUp}
            onClick={() => onPromote(ticket.id)}
          />
        )}
        <StripButton
          label={`${attached ? 'Remove' : 'Attach'} ${ticket.name} ${attached ? 'from' : 'to'} chat context`}
          icon={attached ? CircleCheck : Paperclip}
          isOn={attached}
          onClick={() => onToggleAttached(ticket.id)}
        />
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Move ${ticket.name} to another lane`}
          title={canReorder ? 'Reorder or move to another lane' : 'Move to another lane'}
          {...stylex.props(styles.stripButton, styles.stripHandle)}
        >
          <Icon icon={GripVertical} size="sm" />
        </button>
      </span>
    </li>
  );
}

function StripButton({
  label,
  icon,
  isOn = false,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  isOn?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isOn || undefined}
      title={label}
      {...stylex.props(styles.stripButton, isOn && styles.stripOn)}
      onClick={onClick}
    >
      <Icon icon={icon} size="sm" />
    </button>
  );
}

/** What a board row says, shared by the row in its lane and the copy that follows a drag. */
function TicketRowBody({
  ticket,
  attached,
  linkedChats,
  onOpenChat,
}: {
  ticket: Ticket;
  attached: boolean;
  linkedChats: ChatSummary[];
  onOpenChat?: (chatId: string) => void;
}) {
  const said = holding(ticket);
  const person = ticket.claim?.holder.name ?? ticket.author?.name ?? null;
  const openChildren = ticket.children.filter((child) => !child.closed).length;
  const firstChat = linkedChats[0];

  return (
    <>
      <span {...stylex.props(styles.rowTop)}>
        <span {...stylex.props(styles.rowKind)} title={ticket.kind}>
          <Icon icon={KIND_ICON[ticket.kind]} size="xsm" />
        </span>
        <span {...stylex.props(styles.rowName)}>{ticket.name}</span>
        <span {...stylex.props(styles.rowAge)} title={`Updated ${when(ticket.updatedAt)}`}>
          {age(ticket.updatedAt)}
        </span>
        {person !== null && (
          <span {...stylex.props(styles.rowPerson)} title={person}>
            {initials(person)}
          </span>
        )}
      </span>
      <span {...stylex.props(styles.rowTitle)}>{ticket.title || 'Untitled'}</span>
      <span {...stylex.props(styles.rowState, ticket.closure === 'wontfix' && styles.abandoned)}>
        <span {...stylex.props(styles.rowStateIcon, BAND_TONE[ticket.band])}>
          <Icon icon={said.icon} size="xsm" />
        </span>
        <span {...stylex.props(styles.rowStateWords)}>{said.words}</span>
      </span>
      <span {...stylex.props(styles.rowTags)}>
        <span {...stylex.props(styles.rowTag)}>
          <span {...stylex.props(styles.kindDot, KIND_HUE[ticket.kind])} />
          {ticket.kind}
        </span>
        {ticket.children.length > 0 && (
          <span {...stylex.props(styles.rowTag)} title="Blocking issues closed">
            <Icon icon={GitBranch} size="xsm" />
            {ticket.children.length - openChildren}/{ticket.children.length}
          </span>
        )}
        {ticket.runs.length > 0 && (
          <span {...stylex.props(styles.rowTag)} title="Runs">
            <Icon icon={History} size="xsm" />
            {ticket.runs.length}
          </span>
        )}
        {firstChat !== undefined && (
          <button
            type="button"
            aria-label={`Open chat: ${firstChat.title}${linkedChats.length > 1 ? `, and ${linkedChats.length - 1} more linked` : ''}`}
            title={`Open chat: ${firstChat.title}`}
            {...stylex.props(styles.rowTag, styles.rowTagButton)}
            onClick={() => onOpenChat?.(firstChat.id)}
          >
            <Icon icon={MessageSquare} size="xsm" />
            {linkedChats.length}
          </button>
        )}
        {attached && (
          <span {...stylex.props(styles.rowTag, styles.rowTagAttached)}>
            <Icon icon={CircleCheck} size="xsm" />
            in chat context
          </span>
        )}
      </span>
    </>
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

function BandHead({
  band,
  count,
  showNote = true,
}: {
  band: { label: string; note: string };
  count: number;
  showNote?: boolean;
}) {
  return (
    <>
      <Text type="label" weight="medium">
        {band.label} <span {...stylex.props(styles.count)}>{count}</span>
      </Text>
      {showNote && (
        <Text type="supporting" color="secondary">
          {band.note}
        </Text>
      )}
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
        <div>
          <Button
            label={placement === 'inline' ? 'Back to the queue' : 'Close issue'}
            icon={<Icon icon={placement === 'inline' ? ArrowLeft : X} size="sm" />}
            variant="ghost"
            size="sm"
            onClick={onLeave}
          />
        </div>
        {head}
      </div>
      {refusal !== null && (
        <div {...stylex.props(styles.refusal)}>
          <Banner status="error" title="Action could not be completed" description={refusal} />
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
  repository,
  executionWorkspaces,
  placement,
  refusal,
  chatIds,
  onLeave,
  onOpen,
  onOpenChat,
  onChanged,
  onRefuse,
  onWrite,
  onGate,
  onUngate,
  onRun,
  onDeliver,
  onQuestion,
  onTakeOver,
  onLetGo,
  onJudge,
  onResolve,
  onRequestRun,
}: {
  ticket: Ticket;
  repository: string;
  executionWorkspaces: ExecutionWorkspace[];
  placement: 'inline' | 'over' | 'beside';
  refusal: string | null;
  chatIds: string[];
  onLeave: () => void;
  onOpen: (id: string) => void;
  onOpenChat: (chatId: string) => void;
  onChanged: () => Promise<void>;
  onRefuse: (message: string | null) => void;
  onWrite: (change: TicketChange) => Promise<Ticket | null>;
  onGate: (gatedBy: string) => Promise<Ticket | null>;
  onUngate: (gatedBy: string) => Promise<Ticket | null>;
  onRun: (executionWorkspaceId: string, followUp?: string) => Promise<boolean>;
  onDeliver: (workspaceId: string, path: DeliveryPath) => Promise<Result<DeliveryAudit>>;
  onQuestion: () => Promise<boolean>;
  onTakeOver: () => Promise<boolean>;
  onLetGo: () => Promise<boolean>;
  onJudge: (verdict: 'accepted' | 'sent-back') => Promise<boolean>;
  onResolve: () => Promise<boolean>;
  onRequestRun: () => void;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [isGating, setIsGating] = useState(false);
  const [named, setNamed] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const hasDescription = ticket.body.trim().length > 0;

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
        <div {...stylex.props(styles.ticketHeader)}>
          <div {...stylex.props(styles.ticketIdentity)}>
            <Text type="code">{ticket.name}</Text>
            <KindTag kind={ticket.kind} />
            <span {...stylex.props(styles.ticketStatus)}>
              <Holding ticket={ticket} />
            </span>
          </div>
          <h2 {...stylex.props(styles.ticketTitle)}>{ticket.title || 'Untitled'}</h2>
        </div>
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
              label="Close as not doing"
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
            {planTicketDrop(ticket, 'running')?.kind === 'start-run' && (
              <Button
                label="Start agent"
                size="sm"
                variant="primary"
                isDisabled={isBusy}
                onClick={onRequestRun}
              />
            )}
            {/* Run is offered on a ready ticket and nowhere else, because whether a ticket
                can be picked up is the server's answer and its own words are what is shown
                when it says no. */}
            {ticket.kind === 'question' &&
              (ticket.band === 'ready' || ticket.band === 'needs-you') && (
                <Button
                  label={ticket.band === 'needs-you' ? 'Resume question' : 'Start question'}
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
                  label="Accept result"
                  size="sm"
                  variant="primary"
                  isDisabled={isBusy}
                  onClick={() => void run(() => onJudge('accepted'))}
                />
                <Button
                  label="Send back"
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
                label="Release claim"
                size="sm"
                variant="ghost"
                isDisabled={isBusy}
                onClick={() => void run(onLetGo)}
              />
            )}
            {ticket.gate === 'draft' ? (
              <>
                <Button
                  label="Mark ready for an agent"
                  size="sm"
                  variant="primary"
                  isDisabled={isBusy}
                  onClick={() => void run(() => onWrite({ gate: 'ready-for-agent' }))}
                />
                <Button
                  label="Mark ready for a person"
                  size="sm"
                  variant="secondary"
                  isDisabled={isBusy}
                  onClick={() => void run(() => onWrite({ gate: 'ready-for-human' }))}
                />
              </>
            ) : (
              <Button
                label="Return to draft"
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
              About
            </Text>
            {hasDescription ? (
              <Text type="body" {...stylex.props(styles.ticketBodyText)}>
                {ticket.body}
              </Text>
            ) : (
              <Text type="supporting" color="secondary">
                No description has been added yet.
              </Text>
            )}
          </section>

          <section {...stylex.props(styles.section)}>
            <div {...stylex.props(styles.ticketSectionHeading)}>
              <Text type="label" weight="medium">
                Done when
              </Text>
              {ticket.criteria.length > 0 && (
                <Text type="supporting" color="secondary">
                  {ticket.criteria.length} {ticket.criteria.length === 1 ? 'check' : 'checks'}
                </Text>
              )}
            </div>
            {ticket.criteria.length === 0 ? (
              <Text type="supporting" color="secondary">
                No finish line has been written yet. Add one before marking this ready for an agent.
              </Text>
            ) : (
              <ul {...stylex.props(styles.ticketCriteria)}>
                {ticket.criteria.map((line, at) => (
                  <li key={`${at}-${line}`} {...stylex.props(styles.ticketCriterion)}>
                    <Icon
                      icon={CircleDashed}
                      size="sm"
                      {...stylex.props(styles.ticketCriterionIcon)}
                    />
                    <Text type="supporting" {...stylex.props(styles.ticketCriterionText)}>
                      {line === '' ? '(an empty line)' : line}
                    </Text>
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

          <details {...stylex.props(styles.ticketDetails)}>
            <summary {...stylex.props(styles.ticketDetailsSummary)}>
              <span {...stylex.props(styles.ticketDetailsSummaryText)}>
                <Text type="label" weight="medium">
                  More ticket details
                </Text>
                <Text type="supporting" color="secondary">
                  Runs, dependencies, and branch
                </Text>
              </span>
            </summary>
            <div {...stylex.props(styles.ticketDetailsContent)}>
              <div {...stylex.props(styles.ticketFacts)}>
                <div {...stylex.props(styles.ticketFact)}>
                  <Text type="supporting" color="secondary">
                    Rank
                  </Text>
                  <Text type="supporting" {...stylex.props(styles.ticketFactValue)}>
                    {ticket.rank}
                  </Text>
                </div>
                {ticket.author !== null && (
                  <div {...stylex.props(styles.ticketFact)}>
                    <Text type="supporting" color="secondary">
                      Written by
                    </Text>
                    <Text type="supporting" {...stylex.props(styles.ticketFactValue)}>
                      {ticket.author.name}
                    </Text>
                  </div>
                )}
              </div>

              {/* What a run made of it, above the queue's own facts: on a ticket somebody or
                  something has worked, this is what the ticket is waiting on. */}
              <RunHistory ticket={ticket} chatIds={chatIds} onOpenChat={onOpenChat} />

              <ExecutionWorkspacePanel
                ticket={ticket}
                workspaces={executionWorkspaces}
                repository={repository}
                onStart={onRun}
                onDeliver={onDeliver}
                onChanged={onChanged}
              />

              <section {...stylex.props(styles.section)}>
                <Text type="label" weight="medium">
                  What gates it
                </Text>
                {ticket.children.length === 0 ? (
                  <Text type="supporting" color="secondary">
                    Nothing gates this. A ticket names the tickets that hold it up, and a parent
                    names its slices.
                  </Text>
                ) : (
                  <>
                    <Text type="supporting" color="secondary">
                      {ticket.children.filter((each) => each.closed).length} of{' '}
                      {ticket.children.length} closed
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
                          label="Which issue blocks this one"
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
            </div>
          </details>
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
    const answer = await window.kira.readTranscript(ticketId, run.id);

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
            New ticket
          </Text>
          <Text type="supporting" color="secondary">
            New tickets start as drafts. Mark one ready when it is clear enough to run.
          </Text>
        </>
      }
      foot={
        <>
          <Button
            label={isBusy ? 'Creating issue' : 'Create issue'}
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
              if (KINDS.some((each) => each === next)) setKind(next as TicketKind);
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
          description="What the issue is called. Its suggested branch name comes from the title."
        />
        <TextArea
          label="Description"
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
      <TextArea label="Description" value={body} onChange={setBody} rows={6} />
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

/** Which reading the window opens on, from `?view=` — Board is the default. */
function readView(): View {
  const asked = new URLSearchParams(window.location.search).get('view') ?? '';

  return asked === 'queue' ? 'list' : isView(asked) ? asked : 'board';
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
