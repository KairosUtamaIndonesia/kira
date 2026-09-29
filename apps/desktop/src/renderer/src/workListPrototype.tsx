/**
 * PROTOTYPE — throwaway. Three layouts for Work's List view, switchable from a
 * development-only bar, with the ticket's drawer beside the list the way the board has it.
 *
 * Question it answers: what should a list of tickets look like next to the ledger board —
 * one line per ticket, two lines, or a table with column headings? Every variant reads the
 * same tickets and groups as the real list. Opening a ticket is real; sorting from a
 * column heading is a stub. Once a layout wins, rewrite it in `work.tsx` and drop this file.
 */
import { Icon } from '@astryxdesign/core/Icon';
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
  Bug,
  ChevronDown,
  CircleHelp,
  FileText,
  FlaskConical,
  GitBranch,
  GripVertical,
  History,
  Map as MapIcon,
  MessageSquare,
  Search,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  createContext,
  useContext,
  useState,
  type PointerEventHandler,
  type ReactNode,
} from 'react';
import type { Band, ChatSummary, Ticket, TicketKind } from '../../preload/bridge.ts';
import { groupedWork, type WorkGroup } from './workDisplay.ts';
import { age, holding, inBand, when } from './workRows.ts';

const VARIANTS = [
  { id: 'line', label: 'One line' },
  { id: 'two', label: 'Two lines' },
  { id: 'table', label: 'Table' },
] as const;
type Variant = (typeof VARIANTS)[number]['id'];

type Lane = { id: Band; label: string; note: string };

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

type Hue = 'cyan' | 'orange' | 'purple' | 'teal' | 'pink' | 'gray';
const KIND_HUE: Record<TicketKind, Hue> = {
  feature: 'cyan',
  bug: 'orange',
  refactor: 'purple',
  prototype: 'teal',
  question: 'gray',
  research: 'gray',
  spec: 'pink',
  map: 'pink',
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

interface Group {
  key: string;
  label: string;
  note?: string;
  band?: Band;
  tickets: Ticket[];
}

function groupsFor(tickets: Ticket[], lanes: Lane[], group: WorkGroup): Group[] {
  if (group === 'kind') {
    return groupedWork(tickets, 'kind').map((each) => ({ ...each }));
  }
  return lanes
    .map((lane) => ({
      key: lane.id,
      label: lane.label,
      note: lane.note,
      band: lane.id,
      tickets: inBand(tickets, lane.id),
    }))
    .filter((each) => each.tickets.length > 0);
}

export function ListPrototype({
  tickets,
  lanes,
  group,
  selected,
  chatSummaries,
  onOpen,
  panel,
  canReorder,
  onReorder,
  onDrop,
}: {
  tickets: Ticket[];
  lanes: Lane[];
  group: WorkGroup;
  selected: string | null;
  chatSummaries: ChatSummary[];
  onOpen: (id: string) => void;
  panel: ReactNode;
  canReorder: boolean;
  onReorder: (activeId: string, overId: string) => void;
  onDrop: (ticketId: string, target: Band) => void;
}) {
  const [variant, setVariant] = useState<Variant>('line');
  const [note, setNote] = useState<string | null>(null);
  const [folded, setFolded] = useState<string[]>([]);
  const groups = groupsFor(tickets, lanes, group);
  const chatsFor = (ticket: Ticket): number =>
    chatSummaries.filter((chat) => chat.workTicketIds.includes(ticket.id)).length;
  const toggle = (key: string): void =>
    setFolded((current) =>
      current.includes(key) ? current.filter((each) => each !== key) : [...current, key],
    );
  const shared = { groups, selected, chatsFor, onOpen, folded, onToggle: toggle };
  // Dropping between groups asks for the same actions the board's lanes do. Grouped by
  // kind there is nothing a drop could mean, so rows are not dragged at all.
  const canDrag = group === 'status';
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragging = tickets.find((each) => each.id === draggingId) ?? null;
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
      ? lanes.find((lane) => lane.id === overId.slice('lane:'.length))?.id
      : tickets.find((each) => each.id === overId)?.band;
    if (target === undefined) return;
    if (moved.band === target) {
      if (canReorder && target === 'ready') onReorder(moved.id, overId);
      return;
    }
    onDrop(moved.id, target);
  };

  return (
    <div {...stylex.props(ui.frame)}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => setDraggingId(String(active.id))}
        onDragCancel={() => setDraggingId(null)}
        onDragEnd={handleDragEnd}
      >
        <DragContext.Provider value={canDrag}>
          <div {...stylex.props(ui.scroll)}>
            {variant === 'line' && <OneLine {...shared} />}
            {variant === 'two' && <TwoLines {...shared} />}
            {variant === 'table' && (
              <TableList {...shared} onSort={(by) => setNote(`Sorting by ${by} is stubbed.`)} />
            )}
          </div>
        </DragContext.Provider>
        <DragOverlay dropAnimation={null}>
          {dragging !== null && (
            <div {...stylex.props(ui.overlay)}>
              <span {...stylex.props(ui.kindIcon)}>
                <Icon icon={KIND_ICON[dragging.kind]} size="xsm" />
              </span>
              <span {...stylex.props(ui.id)}>{dragging.name}</span>
              <span {...stylex.props(ui.title)}>{dragging.title || 'Untitled'}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {panel !== null && <div {...stylex.props(ui.drawer)}>{panel}</div>}
      <div {...stylex.props(ui.switcher)} role="toolbar" aria-label="List prototypes">
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
    </div>
  );
}

interface Shared {
  groups: Group[];
  selected: string | null;
  chatsFor: (ticket: Ticket) => number;
  onOpen: (id: string) => void;
  folded: string[];
  onToggle: (key: string) => void;
}

/** A group's heading: its lane's color, its name, how many, and what the lane means. */
function GroupHead({
  group,
  folded,
  onToggle,
  asRow = false,
  belowHeadings = false,
}: {
  group: Group;
  folded: boolean;
  onToggle: () => void;
  asRow?: boolean;
  belowHeadings?: boolean;
}) {
  return (
    <button
      type="button"
      aria-expanded={!folded}
      {...stylex.props(ui.groupHead, asRow && ui.groupHeadRow, belowHeadings && ui.groupHeadBelow)}
      onClick={onToggle}
    >
      <span {...stylex.props(ui.chevron, folded && ui.chevronFolded)}>
        <Icon icon={ChevronDown} size="xsm" />
      </span>
      {group.band !== undefined ? (
        <span {...stylex.props(ui.dot, laneFill[group.band])} aria-hidden />
      ) : (
        <span {...stylex.props(ui.dot, hueFill[KIND_HUE[group.key as TicketKind]])} aria-hidden />
      )}
      <span {...stylex.props(ui.groupLabel)}>{group.label}</span>
      <span {...stylex.props(ui.groupCount)}>{group.tickets.length}</span>
      {group.note !== undefined && <span {...stylex.props(ui.groupNote)}>{group.note}</span>}
    </button>
  );
}

function Tags({ ticket, chats }: { ticket: Ticket; chats: number }) {
  const open = ticket.children.filter((each) => !each.closed).length;
  return (
    <span {...stylex.props(ui.tags)}>
      <span {...stylex.props(ui.tag)}>
        <span {...stylex.props(ui.kindDot, hueFill[KIND_HUE[ticket.kind]])} />
        {ticket.kind}
      </span>
      {ticket.children.length > 0 && (
        <span {...stylex.props(ui.tag)} title="Blockers closed">
          <Icon icon={GitBranch} size="xsm" />
          {ticket.children.length - open}/{ticket.children.length}
        </span>
      )}
      {ticket.runs.length > 0 && (
        <span {...stylex.props(ui.tag)} title="Sessions">
          <Icon icon={History} size="xsm" />
          {ticket.runs.length}
        </span>
      )}
      {chats > 0 && (
        <span {...stylex.props(ui.tag)} title="Linked chats">
          <Icon icon={MessageSquare} size="xsm" />
          {chats}
        </span>
      )}
    </span>
  );
}

function State({ ticket }: { ticket: Ticket }) {
  const said = holding(ticket);
  return (
    <span {...stylex.props(ui.state)}>
      <span {...stylex.props(ui.stateIcon, laneText[ticket.band])}>
        <Icon icon={said.icon} size="xsm" />
      </span>
      <span {...stylex.props(ui.ellipsis)}>{said.words}</span>
    </span>
  );
}

function Person({ ticket }: { ticket: Ticket }) {
  const person = ticket.claim?.holder.name ?? ticket.author?.name ?? null;
  return person === null ? (
    <span />
  ) : (
    <span {...stylex.props(ui.person)} title={person}>
      {initials(person)}
    </span>
  );
}

const DragContext = createContext(false);

/** A group that takes drops, as a board lane does: the whole section is the target. */
function DropGroup({
  group,
  xstyle,
  children,
}: {
  group: Group;
  xstyle: stylex.StyleXStyles;
  children: ReactNode;
}) {
  const canDrag = useContext(DragContext);
  const { isOver, setNodeRef } = useDroppable({
    id: `lane:${group.key}`,
    disabled: !canDrag || group.band === undefined,
  });
  return (
    <div ref={setNodeRef} {...stylex.props(xstyle, isOver && ui.groupOver)}>
      <SortableContext
        items={group.tickets.map((each) => each.id)}
        strategy={verticalListSortingStrategy}
      >
        {children}
      </SortableContext>
    </div>
  );
}

/**
 * One row that can be dragged: by pointer anywhere on it, and by keyboard from the handle
 * that shows in its left gutter on hover or focus — Enter and Space on the row open it.
 */
function SortableRow({
  ticket,
  xstyle,
  children,
}: {
  ticket: Ticket;
  xstyle: ReadonlyArray<stylex.StyleXStyles | false>;
  children: ReactNode;
}) {
  const canDrag = useContext(DragContext);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: ticket.id, disabled: !canDrag });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform === null ? undefined : `translate3d(0, ${transform.y}px, 0)`,
        transition,
      }}
      onPointerDown={listeners?.onPointerDown as PointerEventHandler<HTMLDivElement> | undefined}
      {...stylex.props(...xstyle, ui.reveal, isDragging && ui.rowDragging)}
    >
      {children}
      {canDrag && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Move ${ticket.name} to another group`}
          title="Drag to reorder or move to another group"
          {...stylex.props(ui.handle)}
        >
          <Icon icon={GripVertical} size="xsm" />
        </button>
      )}
    </div>
  );
}

function OpenCover({ ticket, onOpen }: { ticket: Ticket; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      aria-label={`Open ticket ${ticket.name}: ${ticket.title || 'Untitled'}`}
      {...stylex.props(ui.cover)}
      onClick={() => onOpen(ticket.id)}
    />
  );
}

/* ── A. One line ────────────────────────────────────────────────────────── */

function OneLine({ groups, selected, chatsFor, onOpen, folded, onToggle }: Shared) {
  return (
    <div {...stylex.props(line.grid)}>
      {groups.map((group) => (
        <DropGroup key={group.key} group={group} xstyle={line.section}>
          <GroupHead
            group={group}
            folded={folded.includes(group.key)}
            onToggle={() => onToggle(group.key)}
            asRow
          />
          {!folded.includes(group.key) &&
            group.tickets.map((ticket) => (
              <SortableRow
                key={ticket.id}
                ticket={ticket}
                xstyle={[ui.row, line.row, ticket.id === selected && ui.rowSelected]}
              >
                <OpenCover ticket={ticket} onOpen={onOpen} />
                <span />
                <span {...stylex.props(ui.kindIcon)} title={ticket.kind}>
                  <Icon icon={KIND_ICON[ticket.kind]} size="xsm" />
                </span>
                <span {...stylex.props(ui.id)}>{ticket.name}</span>
                <span {...stylex.props(ui.title)}>{ticket.title || 'Untitled'}</span>
                <State ticket={ticket} />
                <Tags ticket={ticket} chats={chatsFor(ticket)} />
                <Person ticket={ticket} />
                <span {...stylex.props(ui.age)} title={`Updated ${when(ticket.updatedAt)}`}>
                  {age(ticket.updatedAt)}
                </span>
                <span />
              </SortableRow>
            ))}
        </DropGroup>
      ))}
    </div>
  );
}

/* ── B. Two lines ───────────────────────────────────────────────────────── */

function TwoLines({ groups, selected, chatsFor, onOpen, folded, onToggle }: Shared) {
  return (
    <div>
      {groups.map((group) => (
        <DropGroup key={group.key} group={group} xstyle={two.section}>
          <GroupHead
            group={group}
            folded={folded.includes(group.key)}
            onToggle={() => onToggle(group.key)}
          />
          {!folded.includes(group.key) &&
            group.tickets.map((ticket) => (
              <SortableRow
                key={ticket.id}
                ticket={ticket}
                xstyle={[ui.row, two.row, ticket.id === selected && ui.rowSelected]}
              >
                <OpenCover ticket={ticket} onOpen={onOpen} />
                <span {...stylex.props(two.main)}>
                  <span {...stylex.props(two.top)}>
                    <span {...stylex.props(ui.kindIcon)} title={ticket.kind}>
                      <Icon icon={KIND_ICON[ticket.kind]} size="xsm" />
                    </span>
                    <span {...stylex.props(ui.id)}>{ticket.name}</span>
                    <span {...stylex.props(ui.title)}>{ticket.title || 'Untitled'}</span>
                  </span>
                  <span {...stylex.props(two.meta)}>
                    <State ticket={ticket} />
                    <Tags ticket={ticket} chats={chatsFor(ticket)} />
                  </span>
                </span>
                <span {...stylex.props(two.end)}>
                  <Person ticket={ticket} />
                  <span {...stylex.props(ui.age)} title={`Updated ${when(ticket.updatedAt)}`}>
                    {age(ticket.updatedAt)}
                  </span>
                </span>
              </SortableRow>
            ))}
        </DropGroup>
      ))}
    </div>
  );
}

/* ── C. Table ───────────────────────────────────────────────────────────── */

function TableList({
  groups,
  selected,
  onOpen,
  folded,
  onToggle,
  onSort,
}: Shared & { onSort: (by: string) => void }) {
  const columns = ['Ticket', 'Status', 'Kind', 'Blockers', 'Sessions', 'Owner', 'Updated'];
  return (
    <div {...stylex.props(table.grid)} aria-label="Tickets">
      <div {...stylex.props(table.headRow)}>
        <span />
        {columns.map((column) => (
          <button
            key={column}
            type="button"
            {...stylex.props(
              table.headCell,
              column === 'Ticket' && table.headCellSpan,
              column === 'Updated' && table.headCellEnd,
            )}
            onClick={() => onSort(column.toLowerCase())}
          >
            {column}
          </button>
        ))}
      </div>
      {groups.map((group) => (
        <DropGroup key={group.key} group={group} xstyle={table.section}>
          <GroupHead
            group={group}
            folded={folded.includes(group.key)}
            onToggle={() => onToggle(group.key)}
            asRow
            belowHeadings
          />
          {!folded.includes(group.key) &&
            group.tickets.map((ticket) => {
              const open = ticket.children.filter((each) => !each.closed).length;
              const person = ticket.claim?.holder.name ?? ticket.author?.name ?? null;
              return (
                <SortableRow
                  key={ticket.id}
                  ticket={ticket}
                  xstyle={[ui.row, table.row, ticket.id === selected && ui.rowSelected]}
                >
                  <OpenCover ticket={ticket} onOpen={onOpen} />
                  <span />
                  <span {...stylex.props(ui.kindIcon)}>
                    <Icon icon={KIND_ICON[ticket.kind]} size="xsm" />
                  </span>
                  <span {...stylex.props(ui.id)}>{ticket.name}</span>
                  <span {...stylex.props(ui.title)}>{ticket.title || 'Untitled'}</span>
                  <span>
                    <State ticket={ticket} />
                  </span>
                  <span {...stylex.props(table.kind)}>
                    <span {...stylex.props(ui.kindDot, hueFill[KIND_HUE[ticket.kind]])} />
                    {ticket.kind}
                  </span>
                  <span {...stylex.props(table.num)}>
                    {ticket.children.length === 0
                      ? '—'
                      : `${ticket.children.length - open}/${ticket.children.length}`}
                  </span>
                  <span {...stylex.props(table.num)}>
                    {ticket.runs.length === 0 ? '—' : ticket.runs.length}
                  </span>
                  <span {...stylex.props(table.owner)}>{person === null ? '—' : person}</span>
                  <span {...stylex.props(ui.age)} title={`Updated ${when(ticket.updatedAt)}`}>
                    {age(ticket.updatedAt)}
                  </span>
                </SortableRow>
              );
            })}
        </DropGroup>
      ))}
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const laneFill = stylex.create({
  'needs-you': { backgroundColor: colorVars['--color-warning'] },
  ready: { backgroundColor: colorVars['--color-accent'] },
  running: { backgroundColor: colorVars['--color-icon-blue'] },
  blocked: { backgroundColor: colorVars['--color-icon-orange'] },
  draft: { backgroundColor: colorVars['--color-border-emphasized'] },
  done: { backgroundColor: colorVars['--color-success'] },
});

const laneText = stylex.create({
  'needs-you': { color: colorVars['--color-text-yellow'] },
  ready: { color: colorVars['--color-text-accent'] },
  running: { color: colorVars['--color-text-blue'] },
  blocked: { color: colorVars['--color-text-orange'] },
  draft: { color: colorVars['--color-text-secondary'] },
  done: { color: colorVars['--color-text-green'] },
});

const hueFill = stylex.create({
  cyan: { backgroundColor: colorVars['--color-icon-cyan'] },
  orange: { backgroundColor: colorVars['--color-icon-orange'] },
  purple: { backgroundColor: colorVars['--color-icon-purple'] },
  teal: { backgroundColor: colorVars['--color-icon-teal'] },
  pink: { backgroundColor: colorVars['--color-icon-pink'] },
  gray: { backgroundColor: colorVars['--color-icon-secondary'] },
});

const hairline = {
  borderBlockEndWidth: borderVars['--border-width'],
  borderBlockEndStyle: 'solid',
  borderBlockEndColor: colorVars['--color-border'],
} as const;

const ui = stylex.create({
  frame: { display: 'flex', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' },
  scroll: { flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'auto' },
  drawer: {
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 min(420px, 42vw)',
    minWidth: 320,
    minHeight: 0,
    borderInlineStartWidth: borderVars['--border-width'],
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colorVars['--color-border'],
    backgroundColor: colorVars['--color-background-surface'],
  },
  groupHead: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    width: '100%',
    height: 40,
    paddingInline: spacingVars['--spacing-4'],
    borderWidth: 0,
    ...hairline,
    backgroundColor: colorVars['--color-background-body'],
    color: colorVars['--color-text-primary'],
    textAlign: 'start',
    cursor: 'pointer',
    position: 'sticky',
    insetBlockStart: 0,
    zIndex: 1,
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: -2,
  },
  groupHeadRow: { gridColumn: '1 / -1' },
  groupHeadBelow: { insetBlockStart: 32 },
  chevron: {
    display: 'inline-flex',
    color: colorVars['--color-icon-secondary'],
    transitionProperty: 'transform',
    transitionDuration: '120ms',
  },
  chevronFolded: { transform: 'rotate(-90deg)' },
  dot: { width: 8, height: 8, borderRadius: 999, flexShrink: 0 },
  groupLabel: { fontSize: textSizeVars['--font-size-base'], fontWeight: 500 },
  groupCount: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  groupNote: {
    marginInlineStart: spacingVars['--spacing-2'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  row: {
    position: 'relative',
    ...hairline,
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
  },
  reveal: { '--row-reveal': { default: '0', ':hover': '1', ':focus-within': '1' } },
  rowDragging: { opacity: 0.4 },
  groupOver: { backgroundColor: colorVars['--color-overlay-hover'] },
  handle: {
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
    opacity: 'var(--row-reveal)',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: -2,
  },
  overlay: {
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
  rowSelected: {
    backgroundColor: {
      default: colorVars['--color-accent-muted'],
      ':hover': colorVars['--color-accent-muted'],
    },
  },
  cover: {
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
  kindIcon: { display: 'inline-flex', color: colorVars['--color-icon-secondary'] },
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
    fontWeight: 500,
    color: colorVars['--color-text-primary'],
  },
  state: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1-5'],
    minWidth: 0,
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  stateIcon: { display: 'inline-flex', flexShrink: 0 },
  ellipsis: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tags: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-1'] },
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height: 20,
    paddingInline: 6,
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: 999,
    fontSize: '0.6875rem',
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  kindDot: { width: 6, height: 6, borderRadius: 999, flexShrink: 0 },
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
  age: {
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'end',
    whiteSpace: 'nowrap',
  },
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

/* One grid for the whole list, so every column lines up across groups. */
const line = stylex.create({
  grid: {
    display: 'grid',
    // The first and last tracks are the row's side padding (4px + one 12px gap = 16px):
    // a subgrid row cannot pad itself without squeezing the columns it shares.
    gridTemplateColumns:
      '4px 16px max-content minmax(0, 1fr) minmax(0, max-content) max-content 20px 32px 4px',
    columnGap: spacingVars['--spacing-3'],
  },
  section: { display: 'grid', gridTemplateColumns: 'subgrid', gridColumn: '1 / -1' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'subgrid',
    gridColumn: '1 / -1',
    alignItems: 'center',
    height: 40,
  },
});

const two = stylex.create({
  section: { display: 'block' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
    paddingBlock: 10,
    paddingInline: spacingVars['--spacing-4'],
  },
  main: { display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 },
  top: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-2'], minWidth: 0 },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
    paddingInlineStart: 24,
    minWidth: 0,
  },
  end: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
    flexShrink: 0,
  },
});

const table = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns:
      '4px 16px max-content minmax(160px, 1fr) minmax(120px, 200px) 88px 64px 64px minmax(80px, 140px) 56px 4px',
    columnGap: spacingVars['--spacing-3'],
    // Wide enough for every column at its narrowest; past that the list scrolls sideways.
    minWidth: 850,
  },
  headRow: {
    display: 'grid',
    gridTemplateColumns: 'subgrid',
    gridColumn: '1 / -1',
    alignItems: 'center',
    height: 32,
    ...hairline,
    position: 'sticky',
    insetBlockStart: 0,
    zIndex: 2,
    backgroundColor: colorVars['--color-background-surface'],
  },
  headCell: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    textAlign: 'start',
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 500,
    color: {
      default: colorVars['--color-text-secondary'],
      ':hover': colorVars['--color-text-primary'],
    },
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  headCellSpan: { gridColumn: '2 / 5' },
  headCellEnd: { textAlign: 'end' },
  section: { display: 'grid', gridTemplateColumns: 'subgrid', gridColumn: '1 / -1' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'subgrid',
    gridColumn: '1 / -1',
    alignItems: 'center',
    height: 40,
  },
  kind: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  num: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  owner: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
});
