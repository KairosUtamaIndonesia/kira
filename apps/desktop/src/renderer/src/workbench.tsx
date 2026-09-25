/**
 * The workbench: the pane beside the conversation, holding what Kira is holding
 * for this chat, and the strip that whatever else it comes to hold arrives in.
 *
 * One strip, every tab filling the pane from the strip down. The tabs are peers
 * rather than a strip inside a view of their own, because the pane is narrow and
 * a second strip costs more room than a second level explains.
 *
 * Which chat's things it holds is the chat on screen's business. How wide it is
 * and whether it is showing are the window's, kept where the sidebar's width is
 * kept and read back on the next run, because they describe this window rather
 * than any one chat.
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { ResizeHandle, useResizable, type ResizableRegion } from '@astryxdesign/core/Resizable';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { X } from 'lucide-react';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';
import type {
  ChatConclusion,
  ChatMemory,
  ShapingState,
  Ticket,
  TicketQueue,
} from '../../preload/bridge';
import { ProposalCard, type ProposalVerdict } from './proposalCard';
import {
  approvedSpecTicket,
  canRetryBreakdownReady,
  latestProposals,
  shapingTabs,
  ticketsFor,
} from './specPane';
import { ContextTab } from './contextTab';
import { FileTab } from './fileTab';
import { BrowserWorkspace } from './browser/BrowserWorkspace';
import { browsersFromPersistence, browsersOf, type BrowsersByChat } from './browser/state';
import { styles as browserStyles } from './browser/styles';
import {
  type ByChat,
  BROWSER,
  CONTEXT,
  SPEC,
  TICKETS,
  type Reading,
  WORKSPACE,
  closed,
  contentsOf,
  nameOf,
  opened,
  shown,
  tabsOf,
  valueOf,
} from './workbenchTabs';
import { WorkspaceTab } from './workspaceTab';

/** Where the window's width and whether it is showing are remembered. */
const WORKBENCH_STORAGE_KEY = 'foundry.workbench';
const BROWSER_STORAGE_KEY = 'foundry.browsers.v1';

/**
 * Where a drag stops being a narrower pane and becomes no pane at all. Inside the
 * drag range the pane clamps at its minimum rather than following the pointer any
 * further; this is the width below which letting go takes it away instead.
 */
const COLLAPSED_SIZE = 240;

/** The id of the panel a tab opens. A file's tab is named by its path. */
function panelOf(value: string): string {
  return `workbench-${value}`;
}
/**
 * The pane's own state, held by the window because two places need it: the chat
 * header holds the control that shows and hides the pane, and the pane holds its
 * own width. One region, handed to both.
 */
export function useWorkbench(): ResizableRegion {
  return useResizable({
    autoSaveId: WORKBENCH_STORAGE_KEY,
    defaultSize: 380,
    minSize: 300,
    maxSize: 720,
    collapsible: true,
    collapsedSize: COLLAPSED_SIZE,
  });
}

export function Workbench({
  region,
  memory,
  conclusions,
  chatId,
  composing,
  workspaceName,
  shaping,
  ticketQueue,
  onDecide,
  onOpenWork,
}: {
  region: ResizableRegion;
  memory: readonly ChatMemory[];
  /** What Kira has worked out for the chat on screen, drawn with what Kira holds. */
  conclusions: readonly ChatConclusion[];
  /** The chat on screen, whose workspace the tree in the other tab is of. */
  chatId: string;
  /** Whether the chat on screen is the one being composed, which has no workspace yet. */
  composing: boolean;
  /** What to call the folder the chat works in, or null for one Foundry made. */
  workspaceName: string | null;
  shaping: ShapingState;
  /** The approved spec's tickets, read from the queue; null until there are any to read. */
  ticketQueue: TicketQueue | null;
  /** A person's verdict on a proposal: the server's refusal, or null when it was taken. */
  onDecide: (proposalId: string, verdict: ProposalVerdict) => Promise<string | null>;
  onOpenWork: (ticket: Ticket) => void;
}) {
  // What this chat has open, and which of its tabs is showing. The files a chat
  // has open are the chat's own, so a switch leaves both where they were.
  const [tabs, setTabs] = useState<ByChat>(new Map());
  // What has been read of the open files, under the chat and path it was read
  // for: a path means nothing outside the chat it is relative to.
  const [readings, setReadings] = useState<ReadonlyMap<string, Reading>>(new Map());
  // How many times the workspace has been asked for. The first time is what
  // mounts its tab at all — a tree nobody has looked at is not read — and every
  // time after it is what re-reads the folder the pane names, so a tab that was
  // away comes back showing what is there now rather than what was there then.
  const [workspaceVisits, setWorkspaceVisits] = useState(0);
  const [browsers, setBrowsers] = useState<BrowsersByChat>(() => {
    try {
      const saved = localStorage.getItem(BROWSER_STORAGE_KEY);
      return saved === null ? {} : browsersFromPersistence(JSON.parse(saved));
    } catch {
      return {};
    }
  });
  // Each tab, so closing one can hand focus to the tab that took its place
  // without reaching for Astryx's own attributes.
  const tabRefs = useRef(new Map<string, HTMLButtonElement | null>());

  // Spec and Tickets are there only while the chat has something to show in
  // them; a chat that has a proposal and has chosen nothing opens on Spec.
  const available = shapingTabs(shaping);
  const held = tabsOf(tabs, chatId, available.spec ? SPEC : CONTEXT);
  const open = held.open;
  const showing =
    (held.showing === SPEC && !available.spec) || (held.showing === TICKETS && !available.tickets)
      ? CONTEXT
      : held.showing;

  function readingKey(path: string): string {
    return `${chatId}:${path}`;
  }

  /**
   * A file opened from the tree: its tab arrives, or comes forward if it is there.
   *
   * The file is read here rather than in the tab it opens, so an answer is kept
   * under the chat and path it was asked for: one that arrives after a chat
   * switch belongs to the chat that asked, and the tab on screen is showing
   * another chat's file by then.
   */
  function openFile(path: string) {
    setTabs(opened(tabs, chatId, path));

    void window.foundry.readWorkspaceFile(chatId, path).then((result) => {
      setReadings((held) => new Map(held).set(readingKey(path), contentsOf(result)));
    });
  }

  function closeFile(path: string) {
    const next = closed(tabs, chatId, path);

    setTabs(next);
    // What is no longer open is no longer held, so a file opened again later is
    // read again rather than showing what it held when it was last looked at.
    setReadings((held) => {
      const left = new Map(held);
      left.delete(readingKey(path));
      return left;
    });

    /*
     * The tab that was closed is the one that had focus, so focus follows it to
     * the tab that took its place. Otherwise a reader who closes a tab with the
     * keyboard is left at the top of the window with the strip behind them.
     */
    tabRefs.current.get(tabsOf(next, chatId).showing)?.focus();
  }

  function rememberBrowsers(next: BrowsersByChat): void {
    setBrowsers(next);
    try {
      localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The tabs remain available for this session if storage is unavailable.
    }
  }

  return (
    /*
     * Hidden rather than unmounted while it is put away, the way the draft pane
     * is: what a tab is holding — where the reader had scrolled, what the
     * workspace had opened, what a file had in it — is the mounted thing's to
     * keep. The handle goes with it, since a control for a pane that is not there
     * is a control that lies.
     */
    <div className="workbench-region" style={{ width: region.size }} hidden={region.isCollapsed}>
      <ResizeHandle resizable={region.props} isReversed label="Resize the workbench" />
      <div className="workbench">
        <TabList
          value={showing}
          onChange={(next) => {
            setTabs(shown(tabs, chatId, next));
            // A chat switch should not pay for a tree nobody has looked at, so
            // the workspace is read the first time its tab is shown and kept
            // from then on — and read again every time it is shown after that.
            if (next === WORKSPACE) setWorkspaceVisits((visits) => visits + 1);
            if (next === BROWSER) {
              const browserId = browsersOf(browsers, chatId).activeId;
              if (browserId) void window.foundry.activateBrowser(chatId, browserId);
              else void window.foundry.deactivateBrowser(chatId);
            }
          }}
          hasDivider
          role="tablist"
        >
          <Tab value={CONTEXT} label="Context" panelId={panelOf(CONTEXT)} />
          {available.spec && <Tab value={SPEC} label="Spec" panelId={panelOf(SPEC)} />}
          {available.tickets && <Tab value={TICKETS} label="Tickets" panelId={panelOf(TICKETS)} />}
          <Tab
            value={WORKSPACE}
            label="Workspace"
            panelId={panelOf(WORKSPACE)}
            ref={(element) => {
              tabRefs.current.set(WORKSPACE, element);
            }}
          />
          <Tab value={BROWSER} label="Browser" panelId={panelOf(BROWSER)} />
          {open.map((path) => (
            /*
             * The strip has room for a name, and the name is what it shows and
             * what a reader is told it by. The path is on the tab's tooltip: two
             * files of the same name in different folders are told apart by the
             * tree they were opened from rather than by the strip.
             */
            <Tooltip key={path} content={path} placement="below">
              <Tab
                value={valueOf(path)}
                label={nameOf(path)}
                panelId={panelOf(valueOf(path))}
                ref={(element) => {
                  tabRefs.current.set(valueOf(path), element);
                }}
                endContent={
                  /*
                   * A span rather than a button, because a tab is a button itself
                   * and a button inside one is neither valid markup nor reachable.
                   * The keyboard way to close a tab is Delete on the tab, which is
                   * where focus already is; this glyph is for the pointer.
                   */
                  <span
                    className="workbench-tab-close"
                    aria-hidden="true"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeFile(path);
                    }}
                  >
                    <Icon icon={X} size="sm" />
                  </span>
                }
                onKeyDown={(event) => {
                  // Delete on a Mac keyboard sends Backspace, so both close.
                  if (event.key !== 'Delete' && event.key !== 'Backspace') return;

                  event.preventDefault();
                  closeFile(path);
                }}
              />
            </Tooltip>
          ))}
        </TabList>
        {/*
         * The panel the selected tab points at. Opening any of them sends nothing
         * to a model: what Kira is holding is kept beside the conversation, and
         * the tree and the files are read from the folder on disk, so none of it
         * is a turn.
         */}
        <div
          id={panelOf(CONTEXT)}
          role="tabpanel"
          aria-label="Context"
          className="workbench-tab"
          hidden={showing !== CONTEXT}
        >
          <ContextTab memory={memory} conclusions={conclusions} />
        </div>
        <div
          id={panelOf(SPEC)}
          role="tabpanel"
          aria-label="Spec"
          className="workbench-tab"
          hidden={showing !== SPEC}
        >
          <VStack gap={3}>
            {latestProposals(shaping, ['map', 'spec', 'decision', 'outcome']).map((proposal) => (
              <ProposalCard key={proposal.id} proposal={proposal} onDecide={onDecide} />
            ))}
          </VStack>
        </div>
        <div
          id={panelOf(TICKETS)}
          role="tabpanel"
          aria-label="Tickets"
          className="workbench-tab"
          hidden={showing !== TICKETS}
        >
          <TicketsTab
            // A refusal belongs to the chat it was said in.
            key={chatId}
            shaping={shaping}
            queue={ticketQueue}
            onDecide={onDecide}
            onOpenWork={onOpenWork}
          />
        </div>
        <div
          id={panelOf(WORKSPACE)}
          role="tabpanel"
          aria-label="Workspace"
          className="workbench-tab"
          hidden={showing !== WORKSPACE}
        >
          {workspaceVisits > 0 ? (
            /*
             * Rebuilt rather than reused when the chat on screen changes — and
             * when the chat being composed stops being one, which is when it
             * gains the workspace it had none of. What a tree has read belongs
             * to the chat it was read for, so none of it is carried across.
             */
            <WorkspaceTab
              key={`${chatId}:${composing}`}
              chatId={chatId}
              workspaceName={workspaceName}
              visits={workspaceVisits}
              /*
               * Watched only while the tree is actually on screen: not while
               * another tab is showing, and not while the whole pane is put
               * away, so a folder is never watched for a chat nobody is looking
               * at (ADR 0016).
               */
              showing={showing === WORKSPACE && !region.isCollapsed}
              onOpenFile={openFile}
            />
          ) : null}
        </div>
        <div
          id={panelOf(BROWSER)}
          role="tabpanel"
          aria-label="Browser"
          {...stylex.props(showing === BROWSER ? browserStyles.workbenchTab : browserStyles.hidden)}
        >
          <BrowserWorkspace
            chatId={chatId}
            showing={showing === BROWSER && !region.isCollapsed}
            browsers={browsers}
            onChange={rememberBrowsers}
          />
        </div>
        {/*
         * An open file's panel is mounted while its tab exists and hidden while
         * another tab is showing. What it read is kept by the pane under the chat
         * and path it was read for, so the tab finds it again.
         */}
        {open.map((path) => (
          <div
            key={path}
            id={panelOf(valueOf(path))}
            role="tabpanel"
            aria-label={path}
            className="workbench-tab"
            hidden={showing !== valueOf(path)}
          >
            <FileTab reading={readings.get(readingKey(path))} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The breakdown Kira proposed for the approved spec and the tickets the server
 * holds for it. Work starts from the ticket's own surface, not in this list.
 */
function TicketsTab({
  shaping,
  queue,
  onDecide,
  onOpenWork,
}: {
  shaping: ShapingState;
  queue: TicketQueue | null;
  onDecide: (proposalId: string, verdict: ProposalVerdict) => Promise<string | null>;
  onOpenWork: (ticket: Ticket) => void;
}) {
  const [readyRetryPending, setReadyRetryPending] = useState(false);
  const [readyRetryError, setReadyRetryError] = useState<string | null>(null);
  const specTicketId = approvedSpecTicket(shaping);
  const tickets = ticketsFor(queue, specTicketId);

  async function retryReadiness(): Promise<void> {
    setReadyRetryError(null);
    setReadyRetryPending(true);
    try {
      const result = await window.foundry.retryBreakdownReady();
      if (!result.ok) setReadyRetryError(result.error);
    } catch (error) {
      setReadyRetryError(error instanceof Error ? error.message : String(error));
    } finally {
      setReadyRetryPending(false);
    }
  }

  return (
    <VStack gap={3}>
      {latestProposals(shaping, ['breakdown']).map((proposal) => (
        <VStack key={proposal.id} gap={2}>
          <ProposalCard proposal={proposal} onDecide={onDecide} />
          {canRetryBreakdownReady(proposal) && proposal.readyRefusal !== null && (
            <Banner
              status="error"
              title="Tickets were published as drafts"
              description={proposal.readyRefusal}
              endContent={
                <Button
                  label={readyRetryPending ? 'Marking ready…' : 'Mark ready'}
                  size="sm"
                  variant="secondary"
                  isDisabled={readyRetryPending}
                  onClick={() => void retryReadiness()}
                />
              }
            />
          )}
        </VStack>
      ))}
      {readyRetryError !== null && (
        <Banner
          status="error"
          title="Tickets could not be marked ready"
          description={readyRetryError}
        />
      )}
      {specTicketId !== null &&
        (queue === null ? (
          <Text color="secondary">The approved tickets could not be read yet.</Text>
        ) : (
          tickets.map((ticket) => (
            <HStack key={ticket.id} justify="between" align="center" gap={2}>
              <VStack gap={0.5}>
                <Text type="label">
                  {ticket.name} · {ticket.title}
                </Text>
                <Text type="supporting" color="secondary">
                  {ticket.band}
                </Text>
              </VStack>
              <Button
                label="Open in Work"
                size="sm"
                variant="ghost"
                onClick={() => onOpenWork(ticket)}
              />
            </HStack>
          ))
        ))}
    </VStack>
  );
}
