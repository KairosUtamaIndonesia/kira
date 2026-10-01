/**
 * The chat rail: workspaces and the chats in them, as a ledger.
 *
 * It is drawn the way Work is — ruled sections, one row per chat, mono figures —
 * rather than as a tree. A workspace is a ruled section headed by its name and a
 * zero-padded count; a chat is a row with a status gutter on the left (a ticket
 * link or a live dot) and its age on the right. Both edges are columns, so a list
 * of rows reads as a table. Kira red marks only the chat on screen.
 *
 * A section's tools (Work, new chat, menu) replace its count under the pointer, so
 * a project's work is one click from the rail. The collapsed rail is a column of
 * tiles, one per workspace.
 *
 * The rail takes its data and its actions as props; `App.tsx` owns both.
 */
import { ContextMenu } from '@astryxdesign/core/ContextMenu';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { SideNav, useSideNavCollapse } from '@astryxdesign/core/SideNav';
import {
  colorVars,
  radiusVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  FolderPlus,
  LogOut,
  MessagesSquare,
  Plus,
  Settings2,
  Ticket,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ChatSummary, WorkspaceSummary } from '../../preload/bridge';
import { CHAT_SORT_LABELS, type ChatSort } from './chatOrdering';
import { railMarker } from './chatRail.stylex.ts';
import { copy } from './workCopy.ts';

export interface ChatRailProps {
  header: ReactNode;
  accountName: string;
  workspaces: WorkspaceSummary[];
  /** In the person's chosen order. */
  chats: ChatSummary[];
  currentId: string | null;
  /** Ids of the chats Kira is writing in. */
  running: string[];
  chatSort: ChatSort;
  onChooseSort: (sort: ChatSort) => void;
  openChat: (id: string) => void;
  /** A chat in a workspace, or in none. */
  newChat: (workspaceId: string | null) => void;
  newWorkspace: () => void;
  openWork: (workspaceId: string) => void;
  openWorkHome: () => void;
  removeWorkspace: (id: string) => void;
  archive: (id: string) => void;
  remove: (chat: ChatSummary) => void;
  /** Given only for a chat that is in no project, which is the one that can be moved. */
  move: (chat: ChatSummary) => (() => void) | undefined;
  openSettings: () => void;
  signOut: () => void;
}

/** A section shows this many chats before "Show N more". */
const SECTION_LIMIT = 5;

const DAY = 86_400_000;

/** `now`, `5m`, `3h`, `2d`, `3w`, `4mo`: short enough to sit in a mono column. */
function shortAge(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  if (diff < 30 * DAY) return `${Math.floor(diff / (7 * DAY))}w`;
  return `${Math.floor(diff / (30 * DAY))}mo`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

const initialOf = (name: string): string => name.trim().charAt(0).toUpperCase() || '?';

/** Merge a StyleX result with a plain class, for the few rules styles.css owns. */
function withClass(props: ReturnType<typeof stylex.props>, className: string) {
  return { ...props, className: `${props.className ?? ''} ${className}` };
}

const pulse = stylex.keyframes({
  from: { boxShadow: '0 0 0 0 color-mix(in srgb, currentColor 55%, transparent)' },
  to: { boxShadow: '0 0 0 6px transparent' },
});

const styles = stylex.create({
  // A chat row. The tools and the age share its right edge: the menu replaces the age
  // under the pointer, so nothing moves.
  row: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: {
      default: 'transparent',
      ':hover': colorVars['--color-overlay-hover'],
    },
  },
  rowCurrent: { backgroundColor: colorVars['--color-neutral'] },
  rowMain: {
    display: 'flex',
    flex: 1,
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
    height: 32,
    paddingBlock: 0,
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: 0,
    borderRadius: 'inherit',
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    fontFamily: 'inherit',
    fontSize: '0.8125rem',
    textAlign: 'start',
    cursor: 'pointer',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    outlineStyle: 'solid',
    outlineColor: colorVars['--color-accent'],
    outlineOffset: -2,
  },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  titleCurrent: { fontWeight: 600 },
  // The one red mark on the chat on screen: a dot, or the ticket glyph it already has.
  gutterCurrent: { color: colorVars['--color-accent'] },
  currentDot: {
    width: 6,
    height: 6,
    borderRadius: radiusVars['--radius-full'],
    backgroundColor: colorVars['--color-accent'],
  },
  gutter: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    color: colorVars['--color-text-secondary'],
  },
  figure: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-xs'],
    fontVariantNumeric: 'tabular-nums',
    color: colorVars['--color-text-secondary'],
  },
  age: {
    minWidth: 28,
    textAlign: 'end',
    visibility: {
      default: 'visible',
      [stylex.when.ancestor(':hover', railMarker)]: 'hidden',
      [stylex.when.ancestor(':focus-within', railMarker)]: 'hidden',
    },
  },
  ageHidden: { visibility: 'hidden' },
  rowMenu: {
    position: 'absolute',
    insetBlockStart: '50%',
    insetInlineEnd: spacingVars['--spacing-1'],
    transform: 'translateY(-50%)',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', railMarker)]: 1,
      [stylex.when.ancestor(':focus-within', railMarker)]: 1,
    },
  },
  rowMenuOpen: { opacity: 1 },
  live: {
    width: 6,
    height: 6,
    borderRadius: radiusVars['--radius-full'],
    backgroundColor: colorVars['--color-icon-blue'],
    animationName: pulse,
    animationDuration: '1.8s',
    animationTimingFunction: 'ease-out',
    animationIterationCount: 'infinite',
    color: colorVars['--color-icon-blue'],
    '@media (prefers-reduced-motion: reduce)': { animationName: 'none' },
  },

  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
  },

  // A section: a workspace, or the chats in none.
  section: {
    display: 'flex',
    flexDirection: 'column',
    paddingBlockStart: spacingVars['--spacing-2'],
    marginBlockStart: spacingVars['--spacing-2'],
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  sectionFirst: {
    paddingBlockStart: 0,
    marginBlockStart: 0,
    borderBlockStartWidth: 0,
  },
  head: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    height: 32,
  },
  // The rule under the head of the section that holds the chat on screen.
  headCurrent: {
    '::after': {
      content: '""',
      position: 'absolute',
      insetInline: spacingVars['--spacing-2'],
      insetBlockEnd: -1,
      height: 1,
      backgroundColor: colorVars['--color-accent'],
    },
  },
  toggle: {
    display: 'flex',
    flex: 1,
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
    height: 32,
    paddingBlock: 0,
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: 0,
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    fontFamily: typographyVars['--font-family-heading'],
    fontSize: '0.8125rem',
    fontWeight: 600,
    textAlign: 'start',
    cursor: 'pointer',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    outlineStyle: 'solid',
    outlineColor: colorVars['--color-accent'],
    outlineOffset: 2,
  },
  sectionName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // Right end of a head: the count at rest, replaced by the tools under the pointer.
  slot: {
    position: 'relative',
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    width: 40,
    height: 32,
    paddingInlineEnd: spacingVars['--spacing-2'],
  },
  count: {
    visibility: {
      default: 'visible',
      [stylex.when.ancestor(':hover', railMarker)]: 'hidden',
      [stylex.when.ancestor(':focus-within', railMarker)]: 'hidden',
    },
  },
  // Opaque, so the tools sit over the end of a long name instead of squeezing it at rest.
  tools: {
    position: 'absolute',
    insetBlockStart: '50%',
    insetInlineEnd: spacingVars['--spacing-1'],
    display: 'flex',
    transform: 'translateY(-50%)',
    backgroundColor: colorVars['--color-background-surface'],
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', railMarker)]: 1,
      [stylex.when.ancestor(':focus-within', railMarker)]: 1,
    },
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    paddingBlockStart: spacingVars['--spacing-1'],
  },
  quiet: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    width: '100%',
    height: 28,
    paddingBlock: 0,
    paddingInline: spacingVars['--spacing-2'],
    borderWidth: 0,
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: {
      default: 'transparent',
      ':hover': colorVars['--color-overlay-hover'],
    },
    color: {
      default: colorVars['--color-text-secondary'],
      ':hover': colorVars['--color-text-primary'],
    },
    fontFamily: 'inherit',
    fontSize: textSizeVars['--font-size-sm'],
    textAlign: 'start',
    cursor: 'pointer',
  },

  // The foot of the rail: ruled like the sections above it, with the account's initial
  // in the status gutter's column and its name where chat titles start.
  account: {
    marginBlockStart: spacingVars['--spacing-1'],
    paddingBlockStart: spacingVars['--spacing-1'],
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  accountRow: {
    display: 'flex',
    flex: 1,
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
  },
  avatar: {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    width: 20,
    height: 20,
    // 20px drawn in the 16px gutter column, so the name lines up with chat titles.
    marginInline: -2,
    backgroundColor: colorVars['--color-neutral'],
    color: colorVars['--color-text-primary'],
    fontFamily: typographyVars['--font-family-heading'],
    fontSize: textSizeVars['--font-size-xs'],
    fontWeight: 700,
    lineHeight: 1,
  },
  accountName: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textAlign: 'start',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.8125rem',
    fontWeight: 500,
    color: colorVars['--color-text-primary'],
  },
  accountChevron: { flexShrink: 0, color: colorVars['--color-text-secondary'] },

  // Above the list.
  actions: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-1'] },
  newChat: {
    display: 'inline-flex',
    flex: 1,
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    height: 32,
    paddingBlock: 0,
    paddingInline: spacingVars['--spacing-3'],
    borderWidth: 0,
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: colorVars['--color-neutral'],
    backgroundImage: {
      default: 'none',
      ':hover':
        'linear-gradient(var(--color-overlay-hover), var(--color-overlay-hover))',
    },
    color: colorVars['--color-text-primary'],
    fontFamily: 'inherit',
    fontSize: '0.8125rem',
    fontWeight: 500,
    cursor: 'pointer',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    outlineStyle: 'solid',
    outlineColor: colorVars['--color-accent'],
    outlineOffset: 2,
  },
  collapsedActions: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  tiles: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
  },
  tile: {
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    width: 32,
    height: 32,
    borderWidth: 0,
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: {
      default: colorVars['--color-background-muted'],
      ':hover': colorVars['--color-overlay-hover'],
    },
    color: {
      default: colorVars['--color-text-secondary'],
      ':hover': colorVars['--color-text-primary'],
    },
    fontFamily: typographyVars['--font-family-heading'],
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    outlineStyle: 'solid',
    outlineColor: colorVars['--color-accent'],
    outlineOffset: 2,
  },
  tileLive: {
    position: 'absolute',
    insetBlockStart: 3,
    insetInlineEnd: 3,
  },
});

function chatItems(chat: ChatSummary, p: ChatRailProps) {
  const isRunning = p.running.includes(chat.id);
  // A chat Kira is writing in is neither put away nor thrown away, so both entries
  // say why rather than being missing.
  const writing = isRunning ? 'Kira is writing in this chat.' : undefined;
  const move = p.move(chat);
  return [
    ...(move === undefined
      ? []
      : [
          {
            label: copy.filing.menu,
            description: writing ?? copy.filing.menuNote,
            isDisabled: isRunning,
            onClick: move,
          },
        ]),
    {
      label: 'Archive',
      description: writing ?? 'Out of the sidebar, kept as it is.',
      isDisabled: isRunning,
      onClick: () => p.archive(chat.id),
    },
    {
      label: 'Delete',
      description: writing,
      variant: 'destructive' as const,
      isDisabled: isRunning,
      onClick: () => p.remove(chat),
    },
  ];
}

function workspaceItems(workspace: WorkspaceSummary, p: ChatRailProps) {
  // A workspace with a turn in flight keeps its menu down to what it can still do:
  // there is nothing to take the filing out of while it runs.
  const writing = p.chats.some((c) => c.workspaceId === workspace.id && p.running.includes(c.id));
  return [
    { label: 'Open the work', onClick: () => p.openWork(workspace.id) },
    { label: 'New chat here', onClick: () => p.newChat(workspace.id) },
    ...(writing
      ? []
      : [{ label: 'Remove workspace', onClick: () => p.removeWorkspace(workspace.id) }]),
  ];
}

function SortMenu({ p }: { p: ChatRailProps }) {
  const label = `Sort: ${CHAT_SORT_LABELS[p.chatSort]}`;
  return (
    <DropdownMenu
      button={{
        label,
        icon: <Icon icon={ArrowUpDown} size="sm" />,
        isIconOnly: true,
        variant: 'ghost',
        size: 'sm',
        tooltip: label,
      }}
      items={(Object.keys(CHAT_SORT_LABELS) as ChatSort[]).map((sort) => ({
        id: sort,
        label: CHAT_SORT_LABELS[sort],
        onClick: () => p.onChooseSort(sort),
        endContent: sort === p.chatSort ? <span aria-hidden>✓</span> : undefined,
      }))}
    />
  );
}

/**
 * Settings and sign out are about the account signed into this window rather than
 * any one chat or setting, so they share the one row that names it — the account's
 * own initial and name rather than a plain label, so opening the menu also answers
 * "who am I signed in as". It opens upward: it sits at the foot of the rail, with
 * nothing below it to open into. Both rails (chats and Settings) end with it.
 */
export function AccountMenu({
  name,
  onOpenSettings,
  onSignOut,
}: {
  name: string;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const { isCollapsed } = useSideNavCollapse();
  const label = `${name}, account menu`;
  const avatar = (
    <span {...stylex.props(styles.avatar)} aria-hidden="true">
      {initialOf(name)}
    </span>
  );

  return (
    <div {...stylex.props(!isCollapsed && styles.account)}>
      <DropdownMenu
        placement="above"
        hasChevron={false}
        button={
          isCollapsed
            ? { label, icon: avatar, isIconOnly: true, variant: 'ghost' }
            : {
                label,
                variant: 'ghost',
                width: '100%',
                className: 'account-menu-trigger',
                children: (
                  <span {...stylex.props(styles.accountRow)}>
                    {avatar}
                    <span {...stylex.props(styles.accountName)}>{name}</span>
                    <ChevronsUpDown size={14} {...stylex.props(styles.accountChevron)} aria-hidden />
                  </span>
                ),
              }
        }
        items={[
          { label: 'Settings', icon: <Icon icon={Settings2} size="sm" />, onClick: onOpenSettings },
          { label: 'Sign out', icon: <Icon icon={LogOut} size="sm" />, onClick: onSignOut },
        ]}
      />
    </div>
  );
}

/** One chat. The same row belongs to a workspace and to nobody. */
function ChatRow({ chat, p }: { chat: ChatSummary; p: ChatRailProps }) {
  // The menu's popover renders outside the row, so :focus-within stops matching the
  // moment focus moves into it; track it so the trigger stays for as long as it is up.
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const isCurrent = chat.id === p.currentId;
  const isRunning = p.running.includes(chat.id);
  const items = chatItems(chat, p);

  return (
    <ContextMenu label={`What to do with ${chat.title}`} items={items}>
      <div {...stylex.props(styles.row, isCurrent && styles.rowCurrent, railMarker)}>
        <button
          type="button"
          {...stylex.props(styles.rowMain)}
          aria-current={isCurrent ? 'page' : undefined}
          title={chat.title}
          onClick={() => p.openChat(chat.id)}
        >
          <span {...stylex.props(styles.gutter, isCurrent && styles.gutterCurrent)}>
            {isRunning ? (
              <>
                <span {...stylex.props(styles.live)} aria-hidden="true" />
                <span {...stylex.props(styles.srOnly)}>Kira is writing</span>
              </>
            ) : chat.workTicketIds.length > 0 ? (
              <Ticket size={12} aria-label="Linked to a ticket" />
            ) : isCurrent ? (
              <span {...stylex.props(styles.currentDot)} aria-hidden="true" />
            ) : null}
          </span>
          <span {...stylex.props(styles.title, isCurrent && styles.titleCurrent)}>
            {chat.title}
          </span>
          <span {...stylex.props(styles.figure, styles.age, isMenuOpen && styles.ageHidden)}>
            {shortAge(chat.updatedAt)}
          </span>
        </button>
        <span {...withClass(stylex.props(styles.rowMenu, isMenuOpen && styles.rowMenuOpen), 'rail-tools')}>
          <MoreMenu
            label={`What to do with ${chat.title}`}
            size="sm"
            items={items}
            onOpenChange={setIsMenuOpen}
          />
        </span>
      </div>
    </ContextMenu>
  );
}

function Section({
  id,
  name,
  chats,
  p,
  workspace,
  isFirst,
}: {
  id: string;
  name: string;
  chats: ChatSummary[];
  p: ChatRailProps;
  workspace?: WorkspaceSummary;
  isFirst: boolean;
}) {
  const [isFolded, setIsFolded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const currentIndex = chats.findIndex((c) => c.id === p.currentId);
  // The chat on screen is never hidden behind "Show more".
  const isAllShown = showAll || currentIndex >= SECTION_LIMIT;
  const shown = isAllShown ? chats : chats.slice(0, SECTION_LIMIT);

  return (
    <section {...stylex.props(styles.section, isFirst && styles.sectionFirst)} aria-labelledby={`rail-${id}`}>
      <div {...stylex.props(styles.head, currentIndex >= 0 && styles.headCurrent, railMarker)}>
        <button
          type="button"
          {...stylex.props(styles.toggle)}
          aria-expanded={!isFolded}
          onClick={() => setIsFolded(!isFolded)}
        >
          <span {...stylex.props(styles.gutter)}>
            {isFolded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </span>
          <span id={`rail-${id}`} {...stylex.props(styles.sectionName)}>
            {name}
          </span>
        </button>
        <span {...stylex.props(styles.slot)}>
          <span {...stylex.props(styles.figure, styles.count)}>{pad(chats.length)}</span>
          <span {...withClass(stylex.props(styles.tools), 'rail-tools')}>
            {workspace ? (
              <>
                <IconButton
                  label={`Work in ${name}`}
                  tooltip={`Work in ${name}`}
                  size="sm"
                  variant="ghost"
                  icon={<Icon icon={Ticket} size="sm" />}
                  onClick={() => p.openWork(workspace.id)}
                />
                <IconButton
                  label={`New chat in ${name}`}
                  tooltip={`New chat in ${name}`}
                  size="sm"
                  variant="ghost"
                  icon={<Icon icon={Plus} size="sm" />}
                  onClick={() => p.newChat(workspace.id)}
                />
                <MoreMenu
                  label={`What to do with ${name}`}
                  size="sm"
                  items={workspaceItems(workspace, p)}
                />
              </>
            ) : (
              <SortMenu p={p} />
            )}
          </span>
        </span>
      </div>
      {!isFolded && (
        <div {...stylex.props(styles.rows)}>
          {chats.length === 0 && workspace && (
            // A workspace is drawn with nothing in it before its first chat, which
            // otherwise looks like a section that leads nowhere.
            <button type="button" {...stylex.props(styles.quiet)} onClick={() => p.newChat(workspace.id)}>
              <span {...stylex.props(styles.gutter)} />
              Start the first chat
            </button>
          )}
          {shown.map((chat) => (
            <ChatRow key={chat.id} chat={chat} p={p} />
          ))}
          {!isAllShown && chats.length > SECTION_LIMIT && (
            <button
              type="button"
              {...stylex.props(styles.quiet, styles.figure)}
              onClick={() => setShowAll(true)}
            >
              <span {...stylex.props(styles.gutter)} />
              Show {chats.length - SECTION_LIMIT} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** Workspaces first: a workspace is set up on purpose, so the unfiled chats are what is left over. */
function Ledger({ p }: { p: ChatRailProps }) {
  const { isCollapsed } = useSideNavCollapse();

  if (isCollapsed) {
    // One tile per place. Opening one goes to its latest chat, or starts one.
    const hasUnfiled = p.chats.some((c) => c.workspaceId === null);
    const open = (workspaceId: string | null) => {
      const latest = p.chats.find((c) => c.workspaceId === workspaceId);
      if (latest) p.openChat(latest.id);
      else p.newChat(workspaceId);
    };
    const tile = (id: string | null, label: string, content: ReactNode) => {
      const isRunning = p.chats.some((c) => c.workspaceId === id && p.running.includes(c.id));
      return (
        <button
          key={id ?? 'unfiled'}
          type="button"
          {...stylex.props(styles.tile)}
          aria-label={label}
          title={label}
          onClick={() => open(id)}
        >
          {content}
          {isRunning && (
            <>
              <span {...stylex.props(styles.live, styles.tileLive)} aria-hidden="true" />
              <span {...stylex.props(styles.srOnly)}>Kira is writing</span>
            </>
          )}
        </button>
      );
    };
    return (
      <div {...stylex.props(styles.tiles)}>
        {hasUnfiled && tile(null, 'Chats', <MessagesSquare size={16} />)}
        {p.workspaces.map((w) => tile(w.id, w.name, initialOf(w.name)))}
      </div>
    );
  }

  const unfiled = p.chats.filter((c) => c.workspaceId === null);
  return (
    <div>
      {p.workspaces.map((w, index) => (
        <Section
          key={w.id}
          id={w.id}
          name={w.name}
          workspace={w}
          chats={p.chats.filter((c) => c.workspaceId === w.id)}
          p={p}
          isFirst={index === 0}
        />
      ))}
      {unfiled.length > 0 && (
        <Section id="unfiled" name="Chats" chats={unfiled} p={p} isFirst={p.workspaces.length === 0} />
      )}
    </div>
  );
}

/**
 * What you do to the list: start a chat, open Work, start a workspace. Never
 * disabled — a new chat starts beside whatever Kira is writing in, which is the
 * point of a chat being a session of its own.
 */
function Actions({ p }: { p: ChatRailProps }) {
  const { isCollapsed } = useSideNavCollapse();

  if (isCollapsed) {
    return (
      <div {...stylex.props(styles.collapsedActions)}>
        <IconButton
          label="New chat"
          icon={<Icon icon={Plus} size="sm" />}
          variant="primary"
          onClick={() => p.newChat(null)}
        />
        <IconButton label="Work" icon={<Icon icon={Ticket} size="sm" />} variant="ghost" onClick={p.openWorkHome} />
        <IconButton
          label="New workspace"
          icon={<Icon icon={FolderPlus} size="sm" />}
          variant="ghost"
          onClick={p.newWorkspace}
        />
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.actions)}>
      <button type="button" {...stylex.props(styles.newChat)} onClick={() => p.newChat(null)}>
        <Plus size={14} />
        New chat
      </button>
      <IconButton
        label="Work"
        tooltip="Work"
        icon={<Icon icon={Ticket} size="sm" />}
        variant="ghost"
        onClick={p.openWorkHome}
      />
      <IconButton
        label="New workspace"
        tooltip="New workspace"
        icon={<Icon icon={FolderPlus} size="sm" />}
        variant="ghost"
        onClick={p.newWorkspace}
      />
    </div>
  );
}

export function ChatRail(p: ChatRailProps) {
  return (
    <SideNav
      header={p.header}
      // The header supplies its own collapse button.
      collapsible={{ hasButton: false }}
      // Astryx's own 180px floor cut chat titles to a letter or two.
      resizable={{ autoSaveId: 'kira.sidebar', minWidth: 320 }}
      footer={<AccountMenu name={p.accountName} onOpenSettings={p.openSettings} onSignOut={p.signOut} />}
      topContent={<Actions p={p} />}
    >
      <Ledger p={p} />
    </SideNav>
  );
}
