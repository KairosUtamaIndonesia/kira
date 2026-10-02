/**
 * The Work surface: one project's tickets, on a board or in a list.
 *
 * Board and List are two readings of the same tickets. Opening a ticket puts the
 * same detail panel over either view, so its details stay close to the plan
 * without replacing the board or list. All of its wording lives in `workCopy.ts`.
 *
 * Status is stored by the server. The surface derives only the Blocked marker from
 * open blockers, and groups tickets by that displayed status. What the surface does decide is what to say
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
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Item } from '@astryxdesign/core/Item';
import { edgeCompSlot } from '@astryxdesign/core/Layout';
import { List } from '@astryxdesign/core/List';
import { Selector } from '@astryxdesign/core/Selector';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { useToast } from '@astryxdesign/core/Toast';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  borderVars,
  colorVars,
  focusVars,
  radiusVars,
  shadowVars,
  sizeVars,
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
import { useCallback, useEffect, useState, type PointerEventHandler, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Bug,
  Check,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  FileText,
  FlaskConical,
  FolderOpen,
  GitBranch,
  GripVertical,
  Map as MapIcon,
  Maximize2,
  MessageSquare,
  Paperclip,
  Plus,
  Rows3,
  Search,
  Sparkles,
  SquareKanban,
  Ticket as TicketIcon,
  Wrench,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { age, holding, inStatus, statusOf, suggestPrefix, when } from './workRows.ts';
import {
  canReorderReady,
  DEFAULT_WORK_DISPLAY,
  displayWork,
  groupedWork,
  planTicketDrop,
  readWorkDisplay,
  statusLabel,
  type WorkDisplay,
  type WorkGroup,
  type WorkStatus,
  type TicketDropPlan,
  reorderReady,
} from './workDisplay.ts';
import type {
  AuthState,
  ChatSummary,
  JoinRequest,
  ProjectSummary,
  Ticket,
  TicketChange,
  TicketKind,
  TicketQueue,
  TicketStatus,
  WorkspaceSummary,
} from '../../preload/bridge.ts';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '../../preload/bridge.ts';
import { MarkdownEditor } from './markdownEditor.tsx';
import { Blockers } from './workBlockers.tsx';
import { PullRequests } from './workPullRequests.tsx';
import { Timeline } from './workTimeline.tsx';
import { RepositoriesDialog } from './workRepositories.tsx';
import { NewTicketDialog, oneLine } from './workNewTicket.tsx';
import { FilterBar, FilterToolbar } from './workFilters.tsx';
import { copy } from './workCopy.ts';
import { bodyChange, checksChange, titleChange } from './workChanges.ts';

/** Two readings of the same issues. */
type View = 'board' | 'list';

interface DropIntent {
  ticketId: string;
  target: WorkStatus;
  plan: TicketDropPlan;
}

const VIEWS: { id: View; label: string; icon: LucideIcon; note: string }[] = [
  { id: 'board', icon: SquareKanban, ...copy.views.board },
  { id: 'list', icon: Rows3, ...copy.views.list },
];

/** Stored statuses plus Blocked, which is derived from open blockers. */
const STATUSES: { id: WorkStatus; label: string; note: string }[] = (
  ['needs-review', 'ready', 'running', 'blocked', 'draft', 'done', 'wont-do'] as const
).map((id) => ({ id, ...copy.statuses[id] }));

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

/**
 * A ticket's one-line fields — its title, and each of its checks — are typed in where the words
 * are read, so they are drawn as the words themselves: no box, no border, no fill, growing as
 * they wrap. A focus ring is the only thing that says they can be written in.
 */
const bareField = {
  fieldSizing: 'content',
  resize: 'none',
  width: '100%',
  padding: 0,
  margin: 0,
  borderWidth: 0,
  outline: 'none',
  backgroundColor: 'transparent',
  color: colorVars['--color-text-primary'],
  fontFamily: 'inherit',
  overflowWrap: 'anywhere',
} as const;

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

  /* The List view's table: one grid, every group and row a subgrid of it. */
  tableScroll: { flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' },
  table: {
    display: 'grid',
    gridTemplateColumns:
      '4px 16px max-content minmax(160px, 1fr) minmax(120px, 200px) 88px 64px minmax(80px, 140px) 56px 4px',
    columnGap: spacingVars['--spacing-3'],
    // Wide enough for every column at its narrowest; past that the table scrolls sideways.
    minWidth: 850,
  },
  tableHead: {
    display: 'grid',
    gridTemplateColumns: 'subgrid',
    gridColumn: '1 / -1',
    alignItems: 'center',
    height: 32,
    position: 'sticky',
    insetBlockStart: 0,
    zIndex: 2,
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
    backgroundColor: colorVars['--color-background-surface'],
  },
  tableHeadCell: {
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 500,
    color: colorVars['--color-text-secondary'],
    whiteSpace: 'nowrap',
  },
  tableHeadTicket: { gridColumn: '2 / 5' },
  tableHeadEnd: { textAlign: 'end' },
  tableSection: {
    display: 'grid',
    gridTemplateColumns: 'subgrid',
    gridColumn: '1 / -1',
    transitionProperty: 'background-color',
    transitionDuration: '160ms',
  },
  tableGroup: {
    gridColumn: '1 / -1',
    position: 'sticky',
    insetBlockStart: 32,
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    height: 40,
    paddingInline: spacingVars['--spacing-4'],
    borderWidth: 0,
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
    backgroundColor: colorVars['--color-background-body'],
    color: colorVars['--color-text-primary'],
    textAlign: 'start',
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: '-2px',
  },
  tableChevron: {
    display: 'inline-flex',
    color: colorVars['--color-icon-secondary'],
    transitionProperty: 'transform',
    transitionDuration: '120ms',
  },
  tableChevronFolded: { transform: 'rotate(-90deg)' },
  tableGroupDot: { width: 8, height: 8, flexShrink: 0, borderRadius: radiusVars['--radius-full'] },
  tableGroupLabel: { fontSize: textSizeVars['--font-size-base'], fontWeight: 500 },
  tableGroupNote: {
    minWidth: 0,
    marginInlineStart: spacingVars['--spacing-2'],
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  laneFillNeedsYou: { backgroundColor: colorVars['--color-warning'] },
  laneFillReady: { backgroundColor: colorVars['--color-accent'] },
  laneFillRunning: { backgroundColor: colorVars['--color-icon-blue'] },
  laneFillBlocked: { backgroundColor: colorVars['--color-icon-orange'] },
  laneFillDraft: { backgroundColor: colorVars['--color-border-emphasized'] },
  laneFillDone: { backgroundColor: colorVars['--color-success'] },
  // A board row's look, laid into the table's columns: the subgrid's own gaps, no padding.
  tableRow: {
    display: 'grid',
    gridTemplateColumns: 'subgrid',
    gridColumn: '1 / -1',
    alignItems: 'center',
    height: 40,
    padding: 0,
    columnGap: spacingVars['--spacing-3'],
    rowGap: 0,
  },
  tableTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: textSizeVars['--font-size-base'],
    fontWeight: 500,
    color: colorVars['--color-text-primary'],
  },
  tableKind: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1-5'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  tableNumber: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  tableOwner: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  tableAge: {
    textAlign: 'end',
    whiteSpace: 'nowrap',
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  tableHandle: {
    position: 'absolute',
    insetBlock: 0,
    insetInlineStart: 0,
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colorVars['--color-icon-secondary'],
    cursor: { default: 'grab', ':active': 'grabbing' },
    touchAction: 'none',
    opacity: 'var(--row-reveal, 0)',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: '-2px',
  },
  tableOverlay: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
    width: 520,
    height: 40,
    paddingInline: spacingVars['--spacing-4'],
    borderRadius: 6,
    backgroundColor: colorVars['--color-background-popover'],
    boxShadow: shadowVars['--shadow-med'],
    cursor: 'grabbing',
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
  /*
   * An icon button at the end of a header: its icon lines up with the header's padding and
   * its transparent box hangs into the gutter. IconButton carries no edge-compensation
   * marker, so this is Astryx's rule said by hand: half the box the 16px icon sits in.
   */
  edgeEndIcon: {
    display: 'inline-flex',
    marginInlineEnd: `calc((${sizeVars['--size-element-md']} - 16px) / -2)`,
  },
  panelHeadBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
  },
  fullBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-3'],
    flexShrink: 0,
    height: 44,
    paddingInline: spacingVars['--spacing-4'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
    backgroundColor: colorVars['--color-background-surface'],
  },
  fullBarStart: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
  },
  fullScroll: { flex: 1, minHeight: 0, overflowY: 'auto' },
  fullGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 360px',
    alignItems: 'start',
    gap: spacingVars['--spacing-8'],
    maxWidth: 1180,
    marginInline: 'auto',
    padding: spacingVars['--spacing-6'],
    '@media (max-width: 860px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  fullDoc: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-6'],
    minWidth: 0,
  },
  /* The box's edge is the shadow's own inset ring; it takes no border (DESIGN.md). */
  fullBox: {
    position: 'sticky',
    insetBlockStart: spacingVars['--spacing-6'],
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-5'],
    maxHeight: `calc(100vh - 200px)`,
    overflowY: 'auto',
    padding: spacingVars['--spacing-4'],
    borderRadius: 10,
    backgroundColor: colorVars['--color-background-popover'],
    boxShadow: shadowVars['--shadow-low'],
    '@media (max-width: 860px)': { position: 'static', maxHeight: 'none' },
  },
  fullActions: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacingVars['--spacing-2'],
  },
  fullFacts: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    margin: 0,
  },
  fullFact: {
    display: 'grid',
    gridTemplateColumns: '96px minmax(0, 1fr)',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
  },
  fullFactLabel: {
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  fullFactValue: {
    display: 'flex',
    alignItems: 'center',
    margin: 0,
    fontSize: textSizeVars['--font-size-sm'],
    overflowWrap: 'anywhere',
  },
  /** A property's value button sits flush with the column, like the plain values do. */
  factButton: {
    marginInlineStart: `calc(-1 * ${spacingVars['--spacing-2']})`,
  },
  fullGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
    paddingBlockStart: spacingVars['--spacing-4'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  chatButton: {
    width: '100%',
    minWidth: 0,
    justifyContent: 'flex-start',
  },
  chatButtonLabel: {
    display: 'block',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  workspaceAnchor: { scrollMarginBlockStart: spacingVars['--spacing-6'] },
  branchLine: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
    minWidth: 0,
  },
  branchPill: {
    height: 22,
    paddingInline: 7,
    borderRadius: radiusVars['--radius-element'],
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    lineHeight: '22px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  branchBase: {
    flexShrink: 0,
    color: colorVars['--color-text-secondary'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  branchWork: {
    minWidth: 0,
    color: colorVars['--color-text-primary'],
    backgroundColor: colorVars['--color-neutral'],
  },
  branchPlanned: {
    borderWidth: borderVars['--border-width'],
    borderStyle: 'dashed',
    borderColor: colorVars['--color-border-emphasized'],
    backgroundColor: 'transparent',
    lineHeight: '20px',
  },
  branchArrow: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colorVars['--color-icon-secondary'],
  },
  branchFacts: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
    minWidth: 0,
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
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
    paddingBlock: spacingVars['--spacing-3'],
    paddingInline: spacingVars['--spacing-4'],
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
  /** The ticket's title, held to the heading's own look so typing in it changes nothing. */
  ticketTitle: {
    ...bareField,
    fontSize: '1.375rem',
    fontWeight: 600,
    letterSpacing: '-0.025em',
    lineHeight: 1.25,
    '::placeholder': { color: colorVars['--color-text-secondary'] },
  },
  pullRequestLink: {
    alignSelf: 'flex-start',
    color: colorVars['--color-text-accent'],
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 500,
    textDecorationLine: 'underline',
    textUnderlineOffset: 3,
    borderRadius: radiusVars['--radius-element'],
    ':focus-visible': {
      outlineStyle: focusVars['--focus-outline-style'],
      outlineWidth: focusVars['--focus-outline-width'],
      outlineColor: focusVars['--focus-outline-color'],
      outlineOffset: focusVars['--focus-outline-offset'],
    },
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
    // Removing a check is offered on the row a person is pointing at, or typing in.
    '--row-reveal': { default: '0', ':hover': '1', ':focus-within': '1' },
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
  /** One check, typed in the row it is read in. */
  checkInput: {
    ...bareField,
    flex: 1,
    minWidth: 0,
    fontSize: textSizeVars['--font-size-base'],
    lineHeight: 1.5,
    '::placeholder': { color: colorVars['--color-text-secondary'] },
  },
  checkRemove: { display: 'inline-flex', opacity: 'var(--row-reveal)' },
  /** A ghost button under the checks: its glyph lines up with the check text above it. */
  checkAdd: { display: 'flex', marginInlineStart: `calc(-1 * ${spacingVars['--spacing-3']})` },
  ticketDetails: {
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-background-muted'],
  },
  ticketDetailsSummary: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    // The browser's own marker sits off the text column; the chevron at the end replaces it.
    listStyle: 'none',
    '::-webkit-details-marker': { display: 'none' },
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
  },
  ticketDetailsChevron: {
    display: 'inline-flex',
    color: colorVars['--color-icon-secondary'],
    transitionProperty: 'transform',
    transitionDuration: '120ms',
  },
  ticketDetailsChevronOpen: { transform: 'rotate(180deg)' },
  ticketDetailsContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-4'],
    paddingBlockEnd: spacingVars['--spacing-4'],
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
  /* What a folder that works no project is offered. */
  join: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-4'],
    maxWidth: 640,
    padding: spacingVars['--spacing-6'],
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

/**
 * A ghost text button at the start of a header lines its icon up with the text under it:
 * Astryx's own edge compensation, which pulls a marked button out by its 12px padding so
 * the padding hangs into the gutter instead of indenting the button at rest. Astryx's
 * containers apply it themselves; these headers are ours, so they ask for it.
 */
const EDGE_TEXT_BUTTON = edgeCompSlot.inset(spacingVars['--spacing-3']);

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
  chatSummaries: ChatSummary[];
  /** A ticket to select when Work was opened from the shaping Workbench. */
  initialTicketId?: string | null;
  /** Return to the project navigator, when this surface was entered from there. */
  onBack?: () => void;
  /** Show a linked chat. */
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
  const [isChoosingRepositories, setIsChoosingRepositories] = useState(false);
  /** What the server last refused, in its own words. */
  const toast = useToast();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
  const [isFull, setIsFull] = useState(false);
  const [dropIntent, setDropIntent] = useState<DropIntent | null>(null);
  const [dropBusy, setDropBusy] = useState(false);

  function updateDisplay(change: WorkDisplay | ((current: WorkDisplay) => WorkDisplay)): void {
    setDisplay((current: WorkDisplay) => {
      const next = typeof change === 'function' ? change(current) : change;
      const params = new URLSearchParams(window.location.search);
      const values: [string, string | null][] = [
        ['search', next.search.trim() || null],
        ['status', next.status === 'all' ? null : next.status],
        ['kind', next.kind === 'all' ? null : next.kind],
        ['owner', next.owner === 'all' ? null : next.owner],
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

  // Read the project's ticket store on mount, focus, and after a write.
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

  /**
   * One write, and what the server made of it.
   *
   * Every write is followed by a read so the view reflects stored server state.
   */
  /**
   * Where a refusal is said. What is done inside the ticket's panel is refused in the
   * panel, next to what was being done. A move made from the board or list has no panel to
   * say it in, and the confirmation bar is too small to read a sentence in, so it is a toast.
   */
  function refuse(message: string, shownIn: 'panel' | 'toast'): void {
    if (shownIn === 'panel') {
      setRefusal(message);
      return;
    }
    setRefusal(null);
    toast({ type: 'error', body: message });
  }

  async function wrote(
    act: () => Promise<{ ok: true; value: Ticket } | { ok: false; error: string }>,
    shownIn: 'panel' | 'toast' = 'panel',
  ): Promise<Ticket | null> {
    const answer = await act();
    if (!answer.ok) {
      refuse(answer.error, shownIn);
      return null;
    }

    setRefusal(null);
    await read();
    return answer.value;
  }

  /** Move a Ready ticket to the front of its existing status group. */
  async function promote(id: string): Promise<void> {
    const ready = tickets.filter(
      (each) => !each.blocked && each.status === 'ready' && each.id !== id,
    );
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
        refuse(answer.error, 'toast');
        await read();
        return;
      }
    }

    setRefusal(null);
    await read();
  }

  function beginTicketDrop(ticketId: string, target: WorkStatus): void {
    const ticket = queue?.tickets.find((each) => each.id === ticketId);
    if (ticket === undefined) return;

    const plan = planTicketDrop(ticket, target);
    if (plan === null) return;

    setDropIntent({ ticketId, target, plan });
    setDropBusy(false);
    setRefusal(null);
  }

  function cancelTicketDrop(): void {
    setDropIntent(null);
  }

  async function applyDropWrite(
    action: () => Promise<{ ok: true; value: Ticket } | { ok: false; error: string }>,
  ): Promise<void> {
    setDropBusy(true);
    const changed = await wrote(action, 'toast');
    setDropBusy(false);
    if (changed !== null) setDropIntent(null);
  }

  async function removeDropBlocker(blockerId: string): Promise<void> {
    const ticket = tickets.find((each) => each.id === dropIntent?.ticketId);
    if (ticket === undefined) return;

    setDropBusy(true);
    const removed = await wrote(() => window.kira.ungateTicket(ticket.id, blockerId), 'toast');
    setDropBusy(false);
    if (removed !== null) setDropIntent(null);
  }

  if (workspace === null) {
    return (
      <div {...stylex.props(styles.root)}>
        <div {...stylex.props(styles.scroll)}>
          <EmptyState
            title={copy.states.noFolder.title}
            description={copy.states.noFolder.description}
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
  const doneCount = tickets.filter((ticket) => ticket.status === 'done').length;
  const wontDoCount = tickets.filter((ticket) => ticket.status === 'wont-do').length;
  const visibleStatuses = STATUSES;
  const readyCanReorder = canReorderReady(display);
  const open = tickets.find((each) => each.id === openId) ?? null;
  const me =
    auth?.signedIn === true && typeof auth.user.id === 'string'
      ? { id: auth.user.id, name: auth.user.name }
      : null;
  const placement = 'beside';
  const closePanel = (): void => {
    setIsFull(false);
    setIsWriting(false);
    setOpenId(null);
    setRefusal(null);
  };
  const openTicket = (id: string): void => {
    cancelTicketDrop();
    setIsWriting(false);
    setOpenId(id);
  };
  const panel =
    open === null ? null : (
      <TicketReading
        ticket={open}
        placement={isFull ? 'full' : placement}
        onExpand={() => setIsFull(true)}
        onCollapse={() => setIsFull(false)}
        linkedChats={chatSummaries.filter((chat) => chat.workTicketIds.includes(open.id))}
        tickets={tickets}
        me={me}
        refusal={refusal}
        onLeave={closePanel}
        onOpen={openTicket}
        onOpenChat={onOpenChat}
        onWrite={(change) => wrote(() => window.kira.changeTicket(open.id, change))}
        onGate={(gatedBy) => wrote(() => window.kira.gateTicket(open.id, gatedBy))}
        onUngate={(gatedBy) => wrote(() => window.kira.ungateTicket(open.id, gatedBy))}
      />
    );

  return (
    <div role="presentation" {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.top)}>
        <div {...stylex.props(styles.topTitles)}>
          {onBack !== undefined && (
            <span {...stylex.props(EDGE_TEXT_BUTTON)}>
              <Button
                label={copy.header.backToProjects}
                icon={<Icon icon={ArrowLeft} size="sm" />}
                variant="ghost"
                size="sm"
                onClick={onBack}
              />
            </span>
          )}
          <Text type="label" weight="medium" maxLines={1}>
            {queue?.project.name ?? workspace.name}
          </Text>
          <Text type="supporting" color="secondary" maxLines={1}>
            {queue?.project.prefix ?? copy.none} · {VIEWS.find((each) => each.id === view)?.note}
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
            label={copy.views.label}
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
          <FilterToolbar
            display={display}
            onChange={updateDisplay}
            tickets={tickets}
            lanes={STATUSES}
            kindIcons={KIND_ICON}
            isDisabled={queue === null}
          />
          <Button
            label={copy.header.repositories}
            icon={<Icon icon={GitBranch} size="sm" />}
            variant="secondary"
            size="sm"
            isDisabled={queue === null}
            onClick={() => {
              setOpenId(null);
              setIsFull(false);
              setIsWriting(false);
              setRefusal(null);
              setIsChoosingRepositories(true);
            }}
          />
          <Button
            label={copy.header.newTicket}
            icon={<Icon icon={Plus} size="sm" />}
            variant="primary"
            size="sm"
            onClick={() => {
              setOpenId(null);
              setIsFull(false);
              setIsWriting(true);
              setRefusal(null);
            }}
          />
          {view === 'board' && attachedIds.length > 0 && (
            <Button
              label={copy.header.startChat(attachedIds.length)}
              icon={<Icon icon={TicketIcon} size="sm" />}
              variant="primary"
              size="sm"
              onClick={() => onStartChat(attachedIds)}
            />
          )}
        </div>
      </div>

      <FilterBar
        display={display}
        onChange={updateDisplay}
        lanes={STATUSES}
        shown={visibleTickets.length}
        total={
          tickets.filter(
            (each) => display.showDone || (each.status !== 'done' && each.status !== 'wont-do'),
          ).length
        }
      />

      {isWriting && (
        <NewTicketDialog
          kinds={KINDS}
          kindIcons={KIND_ICON}
          refusal={refusal}
          onCancel={closePanel}
          onWrite={async (draft) => {
            const written = await wrote(() => window.kira.writeTicket(workspace.id, draft));
            if (written !== null) {
              setIsWriting(false);
              setOpenId(written.id);
            }
          }}
        />
      )}

      {isChoosingRepositories && queue !== null && (
        <RepositoriesDialog
          projectId={queue.project.id}
          projectName={queue.project.name}
          onClose={() => setIsChoosingRepositories(false)}
        />
      )}

      {dropIntent !== null && (
        <DropActionBar
          intent={dropIntent}
          ticket={tickets.find((each) => each.id === dropIntent.ticketId) ?? null}
          tickets={tickets}
          isBusy={dropBusy}
          onCancel={cancelTicketDrop}
          onChangeTicket={(ticketId, change) =>
            applyDropWrite(() => window.kira.changeTicket(ticketId, change))
          }
          onAddBlocker={(ticketId, blockerId) =>
            applyDropWrite(() => window.kira.gateTicket(ticketId, blockerId))
          }
          onRemoveBlocker={removeDropBlocker}
        />
      )}

      {trouble !== null && !isWriting ? (
        <div {...stylex.props(styles.scroll)}>
          <QueueReadFailure trouble={trouble} onRetry={() => void read()} />
        </div>
      ) : queue === null && !isWriting ? (
        // The shape of what is coming, rather than a spinner in the middle of
        // nothing: a queue is rows, and three of them say so while it is read.
        <div {...stylex.props(styles.waiting)} aria-busy="true" aria-label={copy.states.loading}>
          <Skeleton width="30%" height={14} />
          <Skeleton width="75%" height={14} index={1} />
          <Skeleton width="65%" height={14} index={2} />
          <Skeleton width="70%" height={14} index={3} />
        </div>
      ) : tickets.length === 0 && !isWriting ? (
        <div {...stylex.props(styles.scroll)}>
          <EmptyState
            title={copy.states.noTickets.title}
            description={copy.states.noTickets.description}
            icon={<Icon icon={FileText} size="lg" />}
            headingLevel={2}
            actions={
              <Button
                label={copy.header.newTicket}
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
            title={copy.states.noMatches.title}
            description={copy.states.noMatches.description}
            icon={<Icon icon={FileText} size="lg" />}
            headingLevel={2}
            actions={
              <Button
                label={copy.filter.clear}
                variant="primary"
                onClick={() => updateDisplay(DEFAULT_WORK_DISPLAY)}
              />
            }
          />
        </div>
      ) : isFull && open !== null && !isWriting ? (
        panel
      ) : view === 'board' ? (
        <BoardView
          tickets={visibleTickets}
          statuses={visibleStatuses}
          showDone={display.showDone}
          doneCount={doneCount}
          wontDoCount={wontDoCount}
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
        <TicketTable
          tickets={visibleTickets}
          statuses={visibleStatuses}
          group={display.group}
          selected={openId}
          onOpen={openTicket}
          panel={panel}
          canReorder={readyCanReorder}
          onReorder={(activeId, overId) => void reorder(activeId, overId)}
          onDrop={beginTicketDrop}
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
        title={copy.states.loadFailed}
        description={trouble}
        endContent={
          <Button label={copy.states.tryAgain} size="sm" variant="secondary" onClick={onRetry} />
        }
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
            {copy.join.topNote}
          </Text>
        </div>
      </div>

      <div {...stylex.props(styles.scroll)}>
        <div {...stylex.props(styles.join)}>
          <Text type="large" weight="medium">
            {copy.join.title}
          </Text>
          <Text type="supporting" color="secondary">
            {copy.join.intro}
          </Text>

          {trouble !== null && (
            <Banner
              status="error"
              title={copy.refused.joinTitle}
              description={trouble}
              endContent={
                <Button
                  label={copy.states.tryAgain}
                  size="sm"
                  variant="secondary"
                  onClick={() => void read()}
                />
              }
            />
          )}

          {projects === null && trouble === null && (
            <div {...stylex.props(styles.waiting)} aria-busy="true" aria-label={copy.join.loading}>
              <Skeleton width="40%" height={14} />
              <Skeleton width="70%" height={14} index={1} />
            </div>
          )}

          {projects !== null && (
            <>
              <Divider />
              <Text type="label" weight="medium">
                {copy.join.existing}
              </Text>
              {projects.length === 0 ? (
                <Text type="supporting" color="secondary">
                  {copy.join.noneYet}
                </Text>
              ) : (
                <List density="compact" hasDividers>
                  {projects.map((each) => (
                    <Item
                      key={each.id}
                      label={each.name}
                      description={copy.join.prefixNote(each.prefix)}
                      endContent={
                        <Button
                          label={copy.join.join}
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
                {copy.join.startHeading}
              </Text>
              <div {...stylex.props(styles.joinFields)}>
                <div {...stylex.props(styles.fieldGrow)}>
                  <TextInput
                    label={copy.join.name}
                    value={name}
                    onChange={setName}
                    description={copy.join.nameNote}
                    size="sm"
                  />
                </div>
                <div {...stylex.props(styles.fieldGrow)}>
                  <TextInput
                    label={copy.join.prefix}
                    value={prefix}
                    onChange={(next) => setPrefix(next.toUpperCase())}
                    description={copy.join.prefixHelp}
                    size="sm"
                  />
                </div>
              </div>
              <div {...stylex.props(styles.joinActions)}>
                <Button
                  label={copy.join.start}
                  variant="primary"
                  size="sm"
                  isDisabled={isJoining || name.trim() === '' || prefix.trim() === ''}
                  onClick={() => void join({ kind: 'new', name, prefix })}
                />
                <Text type="supporting" color="secondary">
                  {auth?.signedIn === false ? copy.join.signedOut : copy.join.chatStillWorks}
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

/**
 * The List view: every ticket in one table, grouped by status (or by kind), with the
 * ticket's drawer beside it the way the board has it. Rows drag between status groups and
 * within Ready exactly as board rows drag between lanes — a drop asks for an action and
 * the server's answer moves the row. Grouped by kind, nothing a drop could mean, so rows
 * stay put.
 *
 * The table is one CSS grid and every group and row is a subgrid of it, so each column
 * lines up down the whole list, headings included. The first and last tracks are the
 * rows' side padding: a subgrid row cannot pad itself without squeezing its columns.
 */
function TicketTable({
  tickets,
  statuses,
  group,
  selected,
  onOpen,
  panel,
  canReorder,
  onReorder,
  onDrop,
}: ViewProps & {
  statuses: typeof STATUSES;
  group: WorkGroup;
  canReorder: boolean;
  onReorder: (activeId: string, overId: string) => void;
  onDrop: (ticketId: string, target: WorkStatus) => void;
}) {
  const [folded, setFolded] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragging = tickets.find((each) => each.id === draggingId) ?? null;
  const canDrag = group === 'status';
  const groups: TableGroup[] =
    group === 'kind'
      ? groupedWork(tickets, 'kind').map((each) => ({
          key: each.key,
          label: each.label,
          tickets: each.tickets,
          kind: each.key as TicketKind,
        }))
      : statuses
          .map((status) => ({
            key: status.id,
            label: status.label,
            note: status.note,
            status: status.id,
            tickets: inStatus(tickets, status.id),
          }))
          .filter((each) => each.tickets.length > 0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    setDraggingId(null);
    if (over === null || active.id === over.id) return;
    const moved = tickets.find((each) => each.id === active.id);
    if (moved === undefined) return;

    const overId = String(over.id);
    const target = overId.startsWith('lane:')
      ? statuses.find((status) => status.id === overId.slice('lane:'.length))?.id
      : (() => {
          const ticket = tickets.find((each) => each.id === overId);
          return ticket === undefined ? undefined : statusOf(ticket);
        })();
    if (target === undefined) return;

    if (statusOf(moved) === target) {
      if (canReorder && target === 'ready') onReorder(moved.id, overId);
      return;
    }

    onDrop(moved.id, target);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => setDraggingId(String(active.id))}
      onDragCancel={() => setDraggingId(null)}
      onDragEnd={handleDragEnd}
    >
      <div {...stylex.props(styles.board)}>
        <div {...stylex.props(styles.tableScroll)}>
          <div {...stylex.props(styles.table)}>
            <div {...stylex.props(styles.tableHead)}>
              <span />
              <span {...stylex.props(styles.tableHeadCell, styles.tableHeadTicket)}>
                {copy.table.ticket}
              </span>
              <span {...stylex.props(styles.tableHeadCell)}>{copy.table.status}</span>
              <span {...stylex.props(styles.tableHeadCell)}>{copy.table.kind}</span>
              <span {...stylex.props(styles.tableHeadCell)}>{copy.table.blockers}</span>
              <span {...stylex.props(styles.tableHeadCell)}>{copy.table.owner}</span>
              <span {...stylex.props(styles.tableHeadCell, styles.tableHeadEnd)}>
                {copy.table.updated}
              </span>
            </div>
            {groups.map((each) => (
              <TableSection
                key={each.key}
                group={each}
                canDrag={canDrag}
                isFolded={folded.includes(each.key)}
                onToggle={() =>
                  setFolded((current) =>
                    current.includes(each.key)
                      ? current.filter((key) => key !== each.key)
                      : [...current, each.key],
                  )
                }
                selected={selected}
                onOpen={onOpen}
              />
            ))}
          </div>
        </div>
        {panel !== null && <div {...stylex.props(styles.boardDrawer)}>{panel}</div>}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging !== null && (
          <div {...stylex.props(styles.tableOverlay)}>
            <span {...stylex.props(styles.rowKind)}>
              <Icon icon={KIND_ICON[dragging.kind]} size="xsm" />
            </span>
            <span {...stylex.props(styles.rowName)}>{dragging.name}</span>
            <span {...stylex.props(styles.tableTitle)}>{dragging.title || copy.untitled}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

interface TableGroup {
  key: string;
  label: string;
  note?: string;
  status?: WorkStatus;
  kind?: TicketKind;
  tickets: Ticket[];
}

/** One group: a heading that folds it, and its rows. A status group takes drops. */
function TableSection({
  group,
  canDrag,
  isFolded,
  onToggle,
  selected,
  onOpen,
}: {
  group: TableGroup;
  canDrag: boolean;
  isFolded: boolean;
  onToggle: () => void;
  selected: string | null;
  onOpen: (id: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `lane:${group.key}`,
    disabled: !canDrag || group.status === undefined,
  });

  return (
    <div ref={setNodeRef} {...stylex.props(styles.tableSection, isOver && styles.columnOver)}>
      <button
        type="button"
        aria-expanded={!isFolded}
        title={group.note}
        {...stylex.props(styles.tableGroup)}
        onClick={onToggle}
      >
        <span {...stylex.props(styles.tableChevron, isFolded && styles.tableChevronFolded)}>
          <Icon icon={ChevronDown} size="xsm" />
        </span>
        <span
          aria-hidden
          {...stylex.props(
            styles.tableGroupDot,
            group.status !== undefined
              ? LANE_FILL[group.status]
              : group.kind !== undefined && KIND_HUE[group.kind],
          )}
        />
        <span {...stylex.props(styles.tableGroupLabel)}>{group.label}</span>
        <span {...stylex.props(styles.laneCount)}>{group.tickets.length}</span>
        {group.note !== undefined && (
          <span {...stylex.props(styles.tableGroupNote)}>{group.note}</span>
        )}
      </button>
      {!isFolded && (
        <SortableContext
          items={group.tickets.map((each) => each.id)}
          strategy={verticalListSortingStrategy}
        >
          {group.tickets.map((ticket) => (
            <TableRow
              key={ticket.id}
              ticket={ticket}
              canDrag={canDrag}
              isSelected={ticket.id === selected}
              onOpen={onOpen}
            />
          ))}
        </SortableContext>
      )}
    </div>
  );
}

/**
 * One ticket as a table row. The whole row opens it and drags by pointer; the handle in
 * its left gutter, shown on hover or focus, is the keyboard's way to move it.
 */
function TableRow({
  ticket,
  canDrag,
  isSelected,
  onOpen,
}: {
  ticket: Ticket;
  canDrag: boolean;
  isSelected: boolean;
  onOpen: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: ticket.id, disabled: !canDrag });
  const said = holding(ticket);
  const openBlockers = ticket.children.filter(
    (child) => child.status !== 'done' && child.status !== 'wont-do',
  ).length;
  const owner = ticket.assignee?.name ?? ticket.author?.name ?? null;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform === null ? undefined : `translate3d(0, ${transform.y}px, 0)`,
        transition,
      }}
      onPointerDown={listeners?.onPointerDown as PointerEventHandler<HTMLDivElement> | undefined}
      {...stylex.props(
        styles.row,
        styles.tableRow,
        isSelected && styles.rowSelected,
        isDragging && styles.rowDragging,
      )}
    >
      <button
        type="button"
        aria-label={copy.row.open(ticket.name, ticket.title)}
        aria-current={isSelected || undefined}
        {...stylex.props(styles.rowOpen)}
        onClick={() => onOpen(ticket.id)}
      />
      <span />
      <span {...stylex.props(styles.rowKind)} title={ticket.kind}>
        <Icon icon={KIND_ICON[ticket.kind]} size="xsm" />
      </span>
      <span {...stylex.props(styles.rowName)}>{ticket.name}</span>
      <span {...stylex.props(styles.tableTitle)}>{ticket.title || copy.untitled}</span>
      <span {...stylex.props(styles.rowState)}>
        <span {...stylex.props(styles.rowStateIcon, STATUS_TONE[statusOf(ticket)])}>
          <Icon icon={said.icon} size="xsm" />
        </span>
        <span {...stylex.props(styles.rowStateWords)}>{said.words}</span>
      </span>
      <span {...stylex.props(styles.tableKind)}>
        <span {...stylex.props(styles.kindDot, KIND_HUE[ticket.kind])} />
        {ticket.kind}
      </span>
      <span {...stylex.props(styles.tableNumber)}>
        {ticket.children.length === 0
          ? copy.none
          : `${ticket.children.length - openBlockers}/${ticket.children.length}`}
      </span>
      <span {...stylex.props(styles.tableOwner)} title={owner ?? undefined}>
        {owner ?? copy.none}
      </span>
      <span {...stylex.props(styles.tableAge)} title={copy.row.updated(when(ticket.updatedAt))}>
        {age(ticket.updatedAt)}
      </span>
      {canDrag && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={copy.table.move(ticket.name)}
          title={copy.table.dragTitle}
          {...stylex.props(styles.tableHandle)}
        >
          <Icon icon={GripVertical} size="xsm" />
        </button>
      )}
    </div>
  );
}

function DropActionBar({
  intent,
  ticket,
  tickets,
  isBusy,
  onCancel,
  onChangeTicket,
  onAddBlocker,
  onRemoveBlocker,
}: {
  intent: DropIntent;
  ticket: Ticket | null;
  tickets: Ticket[];
  isBusy: boolean;
  onCancel: () => void;
  onChangeTicket: (ticketId: string, change: TicketChange) => Promise<void>;
  onAddBlocker: (ticketId: string, blockerId: string) => Promise<void>;
  onRemoveBlocker: (blockerId: string) => Promise<void>;
}) {
  const [selectedBlockerId, setSelectedBlockerId] = useState('');
  if (ticket === null) return null;

  const isClosed = (status: TicketStatus): boolean => status === 'done' || status === 'wont-do';
  const blockerIds = new Set(ticket.children.map((child) => child.id));
  const addableBlockers = tickets.filter(
    (candidate) =>
      candidate.id !== ticket.id && !isClosed(candidate.status) && !blockerIds.has(candidate.id),
  );
  const openBlockers = ticket.children.filter((child) => !isClosed(child.status));
  const chosenBlocker = addableBlockers.find((each) => each.id === selectedBlockerId);
  const chosenOpenBlocker = openBlockers.find((each) => each.id === selectedBlockerId);
  const destination = statusLabel(intent.target);
  const message =
    intent.plan.kind === 'change-status'
      ? copy.drop.move(ticket.name, statusLabel(statusOf(ticket)), destination)
      : intent.plan.kind === 'add-blocker'
        ? copy.drop.addBlocker(ticket.name)
        : copy.drop.removeBlocker(ticket.name);

  return (
    <section {...stylex.props(styles.dropAction)} aria-label={copy.drop.aria} aria-live="polite">
      <div {...stylex.props(styles.dropActionCopy)}>
        <Text type="label" weight="medium">
          {copy.drop.heading(ticket.name, destination)}
        </Text>
        <Text type="supporting" color="secondary">
          {message}
        </Text>
      </div>
      <div {...stylex.props(styles.dropActionTools)}>
        {intent.plan.kind === 'change-status' && (
          <Button
            label={copy.drop.confirmStatus(destination)}
            size="sm"
            variant="primary"
            isDisabled={isBusy}
            onClick={() => {
              if (intent.plan.kind === 'change-status') {
                void onChangeTicket(ticket.id, { status: intent.plan.status });
              }
            }}
          />
        )}
        {intent.plan.kind === 'add-blocker' && (
          <>
            {addableBlockers.length > 0 ? (
              <>
                <div {...stylex.props(styles.dropSelector)}>
                  <Selector
                    label={copy.drop.blocker}
                    options={addableBlockers.map((each) => ({
                      value: each.id,
                      label: `${each.name} · ${each.title || copy.untitled}`,
                    }))}
                    value={chosenBlocker?.id}
                    onChange={setSelectedBlockerId}
                    isDisabled={isBusy}
                  />
                </div>
                <Button
                  label={copy.drop.addBlockerButton}
                  size="sm"
                  variant="primary"
                  isDisabled={isBusy || chosenBlocker === undefined}
                  onClick={() => {
                    if (chosenBlocker !== undefined) void onAddBlocker(ticket.id, chosenBlocker.id);
                  }}
                />
              </>
            ) : (
              <Text type="supporting" color="secondary">
                {copy.drop.noBlockerCandidates}
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
                    label={copy.drop.openBlocker}
                    options={openBlockers.map((each) => ({ value: each.id, label: each.name }))}
                    value={chosenOpenBlocker?.id}
                    onChange={setSelectedBlockerId}
                    isDisabled={isBusy}
                  />
                </div>
                <Button
                  label={copy.drop.removeBlockerButton}
                  size="sm"
                  variant="primary"
                  isDisabled={isBusy || chosenOpenBlocker === undefined}
                  onClick={() => {
                    if (chosenOpenBlocker !== undefined) void onRemoveBlocker(chosenOpenBlocker.id);
                  }}
                />
              </>
            ) : (
              <Text type="supporting" color="secondary">
                {copy.drop.noOpenBlockers}
              </Text>
            )}
          </>
        )}
        <Button
          label={copy.actions.cancel}
          size="sm"
          variant="ghost"
          isDisabled={isBusy}
          onClick={onCancel}
        />
      </div>
    </section>
  );
}

function BoardView({
  tickets,
  statuses,
  showDone,
  doneCount,
  wontDoCount,
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
  statuses: typeof STATUSES;
  showDone: boolean;
  doneCount: number;
  wontDoCount: number;
  onPromote: (id: string) => void;
  canReorder: boolean;
  onReorder: (activeId: string, overId: string) => void;
  onDrop: (ticketId: string, target: WorkStatus) => void;
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
    const targetStatus = overId.startsWith('lane:')
      ? statuses.find((status) => status.id === overId.slice('lane:'.length))?.id
      : (() => {
          const ticket = tickets.find((each) => each.id === overId);
          return ticket === undefined ? undefined : statusOf(ticket);
        })();
    if (targetStatus === undefined) return;

    if (statusOf(activeTicket) === targetStatus) {
      if (canReorder && targetStatus === 'ready') onReorder(String(active.id), overId);
      return;
    }

    onDrop(activeTicket.id, targetStatus);
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
        <section aria-label={copy.board.lanes} {...stylex.props(styles.boardColumns)}>
          {statuses.map((status) => {
            const held = inStatus(tickets, status.id);
            return (
              <BoardLane
                key={status.id}
                status={status}
                tickets={held}
                showDone={showDone}
                count={
                  !showDone && status.id === 'done'
                    ? doneCount
                    : !showDone && status.id === 'wont-do'
                      ? wontDoCount
                      : held.length
                }
                selected={selected}
                canReorder={canReorder && status.id === 'ready'}
                onOpen={onOpen}
                onPromote={onPromote}
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
  'needs-review': styles.laneNeedsYou,
  ready: styles.laneReady,
  running: styles.laneRunning,
  blocked: styles.laneBlocked,
  draft: styles.laneDraft,
  done: styles.laneDone,
  'wont-do': styles.laneDone,
} satisfies Record<WorkStatus, stylex.StyleXStyles>;

const LANE_FILL = {
  'needs-review': styles.laneFillNeedsYou,
  ready: styles.laneFillReady,
  running: styles.laneFillRunning,
  blocked: styles.laneFillBlocked,
  draft: styles.laneFillDraft,
  done: styles.laneFillDone,
  'wont-do': styles.laneFillDone,
} satisfies Record<WorkStatus, stylex.StyleXStyles>;

const STATUS_TONE = {
  'needs-review': styles.toneNeedsYou,
  ready: styles.toneReady,
  running: styles.toneRunning,
  blocked: styles.toneBlocked,
  draft: styles.toneDraft,
  done: styles.toneDone,
  'wont-do': styles.toneDone,
} satisfies Record<WorkStatus, stylex.StyleXStyles>;

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
  status,
  tickets,
  showDone,
  count,
  selected,
  canReorder,
  onOpen,
  onPromote,
  attachedIds,
  onToggleAttached,
  chatsFor,
  onOpenChat,
}: {
  status: (typeof STATUSES)[number];
  tickets: Ticket[];
  showDone: boolean;
  count: number;
  selected: string | null;
  canReorder: boolean;
  onOpen: (id: string) => void;
  onPromote: (id: string) => void;
  attachedIds: string[];
  onToggleAttached: (id: string) => void;
  chatsFor: (ticket: Ticket) => ChatSummary[];
  onOpenChat: (chatId: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `lane:${status.id}` });

  return (
    <div ref={setNodeRef} {...stylex.props(styles.column, isOver && styles.columnOver)}>
      <header title={status.note} {...stylex.props(styles.laneHead, LANE_RULE[status.id])}>
        <span {...stylex.props(styles.laneLabel)}>{status.label}</span>
        <span {...stylex.props(styles.laneCount)}>{String(count).padStart(2, '0')}</span>
      </header>
      <ol aria-label={status.label} {...stylex.props(styles.rows)}>
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
          {(status.id === 'done' || status.id === 'wont-do') && !showDone
            ? copy.board.doneHidden
            : copy.board.empty}
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
        aria-label={copy.row.open(ticket.name, ticket.title)}
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
        {statusOf(ticket) === 'ready' && (
          <StripButton
            label={copy.row.toTop(ticket.name)}
            icon={ArrowUp}
            onClick={() => onPromote(ticket.id)}
          />
        )}
        <StripButton
          label={attached ? copy.row.removeFromChat(ticket.name) : copy.row.addToChat(ticket.name)}
          icon={attached ? CircleCheck : Paperclip}
          isOn={attached}
          onClick={() => onToggleAttached(ticket.id)}
        />
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={copy.row.moveStatus(ticket.name)}
          title={canReorder ? copy.row.handleReorder : copy.row.handleMove}
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
  const person = ticket.assignee?.name ?? ticket.author?.name ?? null;
  const openChildren = ticket.children.filter(
    (child) => child.status !== 'done' && child.status !== 'wont-do',
  ).length;
  const firstChat = linkedChats[0];

  return (
    <>
      <span {...stylex.props(styles.rowTop)}>
        <span {...stylex.props(styles.rowKind)} title={ticket.kind}>
          <Icon icon={KIND_ICON[ticket.kind]} size="xsm" />
        </span>
        <span {...stylex.props(styles.rowName)}>{ticket.name}</span>
        <span {...stylex.props(styles.rowAge)} title={copy.row.updated(when(ticket.updatedAt))}>
          {age(ticket.updatedAt)}
        </span>
        {person !== null && (
          <span {...stylex.props(styles.rowPerson)} title={person}>
            {initials(person)}
          </span>
        )}
      </span>
      <span {...stylex.props(styles.rowTitle)}>{ticket.title || copy.untitled}</span>
      <span {...stylex.props(styles.rowState)}>
        <span {...stylex.props(styles.rowStateIcon, STATUS_TONE[statusOf(ticket)])}>
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
          <span {...stylex.props(styles.rowTag)} title={copy.row.blockersClosed}>
            <Icon icon={GitBranch} size="xsm" />
            {ticket.children.length - openChildren}/{ticket.children.length}
          </span>
        )}
        {firstChat !== undefined && (
          <button
            type="button"
            aria-label={copy.row.openChat(firstChat.title, linkedChats.length - 1)}
            title={copy.row.openChatTitle(firstChat.title)}
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
            {copy.row.inNewChat}
          </span>
        )}
      </span>
    </>
  );
}

/**
 * Where a ticket stands, said the way its board row says it: small, with the icon in its
 * lane's color. Beside the name and kind it is one more fact, not a badge of its own.
 */
function TicketState({ ticket }: { ticket: Ticket }) {
  const said = holding(ticket);

  return (
    <span {...stylex.props(styles.rowState)}>
      <span {...stylex.props(styles.rowStateIcon, STATUS_TONE[statusOf(ticket)])}>
        <Icon icon={said.icon} size="xsm" />
      </span>
      <span {...stylex.props(styles.rowStateWords)}>{said.words}</span>
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

/* ── Leaves the views share: what a thing is, not where it goes ─────────── */

/* ── The ticket — one panel, drawn in one of three places ───────────────── */

/**
 * The frame a ticket is read or written in. The views disagree about where it
 * sits and what is on screen with it, not about what it says: `inline` takes the
 * queue's place, `over` covers the board behind a scrim, `beside` holds a column
 * of its own, and `full` takes the whole surface. `full` is the drawer grown into a
 * page: the ticket reads as a document, and its actions and facts float in a box
 * beside it that holds its place while the document scrolls.
 */
type Placement = 'inline' | 'over' | 'beside' | 'full';

function TicketPanel({
  placement,
  onLeave,
  onExpand,
  onCollapse,
  crumb,
  refusal,
  head,
  foot,
  aside,
  children,
}: {
  placement: Placement;
  onLeave: () => void;
  onExpand?: () => void;
  onCollapse?: () => void;
  crumb?: string;
  refusal: string | null;
  head: ReactNode;
  foot?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const banner = refusal !== null && (
    <div {...stylex.props(styles.refusal)}>
      <Banner status="error" title={copy.refused.panelTitle} description={refusal} />
    </div>
  );

  if (placement === 'full') {
    return (
      <div {...stylex.props(styles.panel)}>
        <div {...stylex.props(styles.fullBar)}>
          <span {...stylex.props(styles.fullBarStart)}>
            {onCollapse !== undefined && (
              // Back to the Work surface, board or list, with this ticket in its drawer —
              // said the way the header's "Back to projects" is, and not as Expand's mirror.
              <span {...stylex.props(EDGE_TEXT_BUTTON)}>
                <Button
                  label={copy.actions.backToWork}
                  icon={<Icon icon={ArrowLeft} size="sm" />}
                  variant="ghost"
                  size="sm"
                  onClick={onCollapse}
                />
              </span>
            )}
            <Text type="supporting" color="secondary" maxLines={1}>
              {crumb}
            </Text>
          </span>
          <span {...stylex.props(styles.edgeEndIcon)}>
            <IconButton
              label={copy.actions.close}
              icon={<Icon icon={X} size="sm" />}
              onClick={onLeave}
            />
          </span>
        </div>
        {banner}
        <div {...stylex.props(styles.fullScroll)}>
          <div {...stylex.props(styles.fullGrid)}>
            <article {...stylex.props(styles.fullDoc)}>
              {head}
              {children}
            </article>
            <aside aria-label={copy.ticket.asideLabel} {...stylex.props(styles.fullBox)}>
              {foot !== undefined && <div {...stylex.props(styles.fullActions)}>{foot}</div>}
              {aside}
            </aside>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.panelHead)}>
        <div {...stylex.props(styles.panelHeadBar)}>
          <span {...stylex.props(EDGE_TEXT_BUTTON)}>
            <Button
              label={placement === 'inline' ? copy.actions.backToWork : copy.actions.close}
              icon={<Icon icon={placement === 'inline' ? ArrowLeft : X} size="sm" />}
              variant="ghost"
              size="sm"
              onClick={onLeave}
            />
          </span>
          {onExpand !== undefined && (
            <span {...stylex.props(styles.edgeEndIcon)}>
              <IconButton
                label={copy.actions.openFullView}
                tooltip={copy.actions.openFullView}
                icon={<Icon icon={Maximize2} size="sm" />}
                onClick={onExpand}
              />
            </span>
          )}
        </div>
        {head}
      </div>
      {banner}
      <div {...stylex.props(styles.panelBody)}>{children}</div>
      {foot !== undefined && <div {...stylex.props(styles.panelFoot)}>{foot}</div>}
    </div>
  );
}

/** One labelled property row in the ticket's aside. */
function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.fullFact)}>
      <dt {...stylex.props(styles.fullFactLabel)}>{label}</dt>
      <dd {...stylex.props(styles.fullFactValue)}>{children}</dd>
    </div>
  );
}

/** One ticket in full, with everything that can be done to it. */
function TicketReading({
  ticket,
  placement,
  refusal,
  onLeave,
  onOpen,
  onOpenChat,
  onWrite,
  onGate,
  onUngate,
  onExpand,
  onCollapse,
  linkedChats = [],
  tickets = [],
  me = null,
}: {
  ticket: Ticket;
  placement: Placement;
  refusal: string | null;
  onLeave: () => void;
  onOpen: (id: string) => void;
  onOpenChat: (chatId: string) => void;
  onWrite: (change: TicketChange) => Promise<Ticket | null>;
  onGate: (blockedBy: string) => Promise<Ticket | null>;
  onUngate: (blockedBy: string) => Promise<Ticket | null>;
  onExpand?: () => void;
  onCollapse?: () => void;
  linkedChats?: ChatSummary[];
  tickets?: Ticket[];
  /** The signed-in person, when the window knows their id, for Assignee. */
  me?: { id: string; name: string } | null;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const pullRequestUrl = ticket.pullRequestUrl;
  /**
   * What the ticket's typed fields hold while a person is in them: its title, its description,
   * and its checks. The server's words are the truth, and these are what they start from and
   * what they are put back to after a refusal, so the pane never keeps a change the server
   * didn't take. Nothing else is held: a keystroke is only ever in the field that has it.
   */
  const [draft, setDraft] = useState({
    title: ticket.title,
    body: ticket.body,
    criteria: ticket.criteria,
  });
  /**
   * The server's words when this draft was taken. A read that answers with something different
   * — another person renaming the ticket, Kira rewriting its description, the drawer opening a
   * different ticket — puts the fields back to what the server says. A read that answers with
   * the same words changes nothing, so a re-read never throws away what is being typed.
   */
  const serverWords = JSON.stringify([ticket.title, ticket.body, ticket.criteria]);
  const [words, setWords] = useState(serverWords);
  if (words !== serverWords) {
    setWords(serverWords);
    setDraft({ title: ticket.title, body: ticket.body, criteria: ticket.criteria });
  }
  const checks = draft.criteria.filter((line) => line.trim() !== '').length;

  async function run(act: () => Promise<unknown>): Promise<void> {
    setIsBusy(true);
    await act();
    setIsBusy(false);
  }

  /**
   * A typed field commits when a person leaves it, and only when it says something the server
   * doesn't already hold. The write re-reads the queue on the way back, so the server's answer
   * is what the pane shows; a refusal leaves the stored words as they were and says why.
   */
  async function save(change: TicketChange | null): Promise<void> {
    if (change === null || isBusy) return;
    await run(async () => {
      const saved = await onWrite(change);
      if (saved === null) {
        setDraft({ title: ticket.title, body: ticket.body, criteria: ticket.criteria });
      }
    });
  }

  /** A new check is a blank row: it says nothing until it is typed in, and is dropped until then. */
  function addCheck(): void {
    setDraft((held) => ({ ...held, criteria: [...held.criteria, ''] }));
  }

  function removeCheck(at: number): void {
    const criteria = draft.criteria.filter((_each, index) => index !== at);
    setDraft((held) => ({ ...held, criteria }));
    void save(checksChange(ticket.criteria, criteria));
  }

  const readFacts: { label: string; value: string }[] = [
    { label: copy.facts.kind, value: ticket.kind },
    { label: copy.facts.createdBy, value: ticket.author?.name ?? copy.none },
    { label: copy.facts.created, value: when(ticket.createdAt) },
    { label: copy.facts.updated, value: when(ticket.updatedAt) },
  ];
  const statusChoices = TICKET_STATUSES.map((status) => ({
    label: copy.statuses[status].label,
    description: copy.statuses[status].note,
    endContent: status === ticket.status ? <Icon icon={Check} size="sm" /> : undefined,
    onClick: () => void run(() => onWrite({ status })),
  }));
  const priorityChoices = TICKET_PRIORITIES.map((priority) => ({
    label: copy.priorities[priority],
    endContent: priority === ticket.priority ? <Icon icon={Check} size="sm" /> : undefined,
    onClick: () => void run(() => onWrite({ priority })),
  }));
  const assigneeChoices = [
    ...(me === null
      ? []
      : [
          {
            label: copy.facts.assignToMe,
            endContent: ticket.assignee?.id === me.id ? <Icon icon={Check} size="sm" /> : undefined,
            onClick: () => void run(() => onWrite({ assigneeId: me.id })),
          },
        ]),
    {
      label: copy.facts.unassign,
      endContent: ticket.assignee === null ? <Icon icon={Check} size="sm" /> : undefined,
      onClick: () => void run(() => onWrite({ assigneeId: null })),
    },
  ];
  const aside =
    placement === 'full' ? (
      <>
        <dl {...stylex.props(styles.fullFacts)}>
          <PropertyRow label={copy.facts.status}>
            <DropdownMenu
              button={{
                label: copy.statusWord[statusOf(ticket)],
                size: 'sm',
                variant: 'ghost',
                isDisabled: isBusy,
                xstyle: styles.factButton,
              }}
              items={statusChoices}
            />
          </PropertyRow>
          <PropertyRow label={copy.facts.priority}>
            <DropdownMenu
              button={{
                label: copy.priorities[ticket.priority],
                size: 'sm',
                variant: 'ghost',
                isDisabled: isBusy,
                xstyle: styles.factButton,
              }}
              items={priorityChoices}
            />
          </PropertyRow>
          <PropertyRow label={copy.facts.assignee}>
            {me === null ? (
              <span {...stylex.props(styles.fullFactValue)}>
                {ticket.assignee?.name ?? copy.facts.nobody}
              </span>
            ) : (
              <DropdownMenu
                button={{
                  label: ticket.assignee?.name ?? copy.facts.nobody,
                  size: 'sm',
                  variant: 'ghost',
                  isDisabled: isBusy,
                  xstyle: styles.factButton,
                }}
                items={assigneeChoices}
              />
            )}
          </PropertyRow>
          {readFacts.map((fact) => (
            <PropertyRow key={fact.label} label={fact.label}>
              <span {...stylex.props(styles.fullFactValue)}>{fact.value}</span>
            </PropertyRow>
          ))}
        </dl>
        <section {...stylex.props(styles.fullGroup)}>
          <Text type="label" weight="medium">
            {copy.ticket.linkedChats}
          </Text>
          {linkedChats.length === 0 ? (
            <Text type="supporting" color="secondary">
              {copy.ticket.noLinkedChats}
            </Text>
          ) : (
            linkedChats.map((chat) => (
              <Button
                key={chat.id}
                label={copy.ticket.openChat(chat.title)}
                icon={<Icon icon={MessageSquare} size="sm" />}
                size="sm"
                variant="ghost"
                width="100%"
                xstyle={styles.chatButton}
                onClick={() => onOpenChat(chat.id)}
              >
                <span {...stylex.props(styles.chatButtonLabel)}>{chat.title}</span>
              </Button>
            ))
          )}
        </section>
      </>
    ) : undefined;

  return (
    <TicketPanel
      placement={placement}
      onLeave={onLeave}
      onExpand={onExpand}
      onCollapse={onCollapse}
      crumb={copy.ticket.crumb(statusLabel(statusOf(ticket)), ticket.name)}
      aside={aside}
      refusal={refusal}
      head={
        <div {...stylex.props(styles.ticketHeader)}>
          <div {...stylex.props(styles.ticketIdentity)}>
            <Text type="code">{ticket.name}</Text>
            <span {...stylex.props(styles.rowTag)}>
              <span {...stylex.props(styles.kindDot, KIND_HUE[ticket.kind])} />
              {ticket.kind}
            </span>
            <TicketState ticket={ticket} />
          </div>
          <textarea
            rows={1}
            aria-label={copy.editor.titleLabel}
            placeholder={copy.editor.titlePlaceholder}
            value={draft.title}
            onChange={(event) => setDraft((held) => ({ ...held, title: event.target.value }))}
            onBlur={() => void save(titleChange(ticket.title, draft.title))}
            onKeyDown={oneLine}
            {...stylex.props(styles.ticketTitle)}
          />
        </div>
      }
    >
      {pullRequestUrl !== null && (
        <a
          href={pullRequestUrl}
          {...stylex.props(styles.pullRequestLink)}
          onClick={(event) => {
            event.preventDefault();
            openLink(pullRequestUrl);
          }}
        >
          {copy.ticket.openPullRequest}
        </a>
      )}
      <PullRequests key={`pull-requests-${ticket.id}`} ticketId={ticket.id} />
      <section {...stylex.props(styles.section)}>
        <Text type="label" weight="medium">
          {copy.ticket.about}
        </Text>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div onBlur={() => void save(bodyChange(ticket.body, draft.body))}>
          <MarkdownEditor
            key={words}
            label={copy.ticket.about}
            initial={ticket.body}
            placeholder={copy.editor.aboutPlaceholder}
            revealToolbarOnFocus
            onChange={(markdown) => setDraft((held) => ({ ...held, body: markdown }))}
          />
        </div>
      </section>
      <section {...stylex.props(styles.section)}>
        <div {...stylex.props(styles.ticketSectionHeading)}>
          <Text type="label" weight="medium">
            {copy.ticket.doneWhen}
          </Text>
          {checks > 0 && (
            <Text type="supporting" color="secondary">
              {copy.ticket.checks(checks)}
            </Text>
          )}
        </div>
        {draft.criteria.length > 0 && (
          <ul {...stylex.props(styles.ticketCriteria)}>
            {draft.criteria.map((line, at) => (
              <li key={at} {...stylex.props(styles.ticketCriterion)}>
                <Icon icon={CircleDashed} size="sm" {...stylex.props(styles.ticketCriterionIcon)} />
                <textarea
                  rows={1}
                  aria-label={copy.editor.checkLabel(at + 1)}
                  placeholder={copy.editor.checkPlaceholder}
                  value={line}
                  onChange={(event) =>
                    setDraft((held) => ({
                      ...held,
                      criteria: held.criteria.map((each, index) =>
                        index === at ? event.target.value : each,
                      ),
                    }))
                  }
                  onBlur={() => void save(checksChange(ticket.criteria, draft.criteria))}
                  onKeyDown={oneLine}
                  {...stylex.props(styles.checkInput)}
                />
                <span {...stylex.props(styles.checkRemove)}>
                  <IconButton
                    label={copy.editor.removeCheck(at + 1)}
                    icon={<Icon icon={X} size="sm" />}
                    variant="ghost"
                    size="sm"
                    isDisabled={isBusy}
                    onClick={() => removeCheck(at)}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
        <span {...stylex.props(styles.checkAdd)}>
          <Button
            label={copy.editor.addCheck}
            icon={<Icon icon={Plus} size="sm" />}
            size="sm"
            variant="ghost"
            isDisabled={isBusy}
            onClick={addCheck}
          />
        </span>
      </section>
      {ticket.kind === 'map' && (ticket.decisionsSoFar?.length ?? 0) > 0 && (
        <section {...stylex.props(styles.section)}>
          <Text type="label" weight="medium">
            {copy.ticket.outcomesSoFar}
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
      {placement === 'full' ? (
        <Blockers
          ticket={ticket}
          tickets={tickets}
          onOpen={onOpen}
          onGate={onGate}
          onUngate={onUngate}
        />
      ) : (
        <details
          {...stylex.props(styles.ticketDetails)}
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        >
          <summary {...stylex.props(styles.ticketDetailsSummary)}>
            <span {...stylex.props(styles.ticketDetailsSummaryText)}>
              <Text type="label" weight="medium">
                {copy.ticket.moreDetails}
              </Text>
              <Text type="supporting" color="secondary">
                {copy.ticket.moreDetailsNote}
              </Text>
            </span>
            <span
              {...stylex.props(
                styles.ticketDetailsChevron,
                detailsOpen && styles.ticketDetailsChevronOpen,
              )}
            >
              <Icon icon={ChevronDown} size="sm" />
            </span>
          </summary>
          <div {...stylex.props(styles.ticketDetailsContent)}>
            <Blockers
              ticket={ticket}
              tickets={tickets}
              onOpen={onOpen}
              onGate={onGate}
              onUngate={onUngate}
            />
            <section {...stylex.props(styles.section)}>
              <Text type="label" weight="medium">
                {copy.ticket.datesHeading}
              </Text>
              <Text type="supporting" color="secondary">
                {copy.ticket.dates(when(ticket.createdAt), when(ticket.updatedAt))}
              </Text>
            </section>
            {linkedChats.map((chat) => (
              <Button
                key={chat.id}
                label={copy.ticket.openChat(chat.title)}
                icon={<Icon icon={MessageSquare} size="sm" />}
                size="sm"
                variant="ghost"
                onClick={() => onOpenChat(chat.id)}
              />
            ))}
          </div>
        </details>
      )}
      <Timeline key={`timeline-${ticket.id}`} ticket={ticket} />
    </TicketPanel>
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
 * A link in a ticket's words opens in the system browser, as every link in the window does:
 * `window.open` reaches the main process's open handler, and the window itself stays put.
 */
function openLink(href: string): false {
  window.open(href, '_blank', 'noopener');
  return false;
}
