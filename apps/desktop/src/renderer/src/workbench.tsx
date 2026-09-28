/**
 * The workbench: the pane beside the conversation, holding what Kira is holding
 * for this chat, the workspace and its files as they arrive.
 *
 * Its views are peers on the activity rail at the outer edge; the selected view
 * fills the rest of the pane, without a horizontal strip taking room from it.
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
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { Brain, FileText, FolderTree, Globe, ListChecks, X } from 'lucide-react';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState, type KeyboardEvent } from 'react';
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
  assetContentsOf,
  closed,
  contentsOf,
  nameOf,
  opened,
  shown,
  tabsOf,
  valueOf,
} from './workbenchTabs';
import { WorkspaceTab } from './workspaceTab';
import { fileKindOf } from './filePreview';

/** Where the window's width and whether it is showing are remembered. */
const WORKBENCH_STORAGE_KEY = 'kira.workbench';
const BROWSER_STORAGE_KEY = 'kira.browsers.v1';

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
    maxSize: 1200,
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
  /** What to call the folder the chat works in, or null for one Kira made. */
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
  const fileTabRefs = useRef(new Map<string, HTMLButtonElement | null>());

  // Spec and Tickets are there only while the chat has something to show in
  // them; a chat that has a proposal and has chosen nothing opens on Spec.
  const available = shapingTabs(shaping);
  const held = tabsOf(tabs, chatId, available.spec ? SPEC : CONTEXT);
  const open = held.open;
  const selectedFile = held.selectedFile;
  const showing =
    (held.showing === SPEC && !available.spec) || (held.showing === TICKETS && !available.tickets)
      ? CONTEXT
      : held.showing;
  const views = [
    { value: CONTEXT, label: 'Context', icon: Brain },
    ...(available.spec ? [{ value: SPEC, label: 'Spec', icon: FileText }] : []),
    ...(available.tickets ? [{ value: TICKETS, label: 'Tickets', icon: ListChecks }] : []),
    { value: WORKSPACE, label: 'Workspace', icon: FolderTree },
    { value: BROWSER, label: 'Browser', icon: Globe },
  ];

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
    const kind = fileKindOf(path);
    const answer = ['image', 'svg', 'pdf', 'audio', 'video', 'font'].includes(kind)
      ? window.kira.readWorkspaceAsset(chatId, path).then(assetContentsOf)
      : window.kira.readWorkspaceFile(chatId, path).then(contentsOf);

    void answer.then((reading) => {
      setReadings((held) => new Map(held).set(readingKey(path), reading));
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

    const nextFile = tabsOf(next, chatId).selectedFile;
    if (nextFile) fileTabRefs.current.get(valueOf(nextFile))?.focus();
    else tabRefs.current.get(WORKSPACE)?.focus();
  }

  function rememberBrowsers(next: BrowsersByChat): void {
    setBrowsers(next);
    try {
      localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The tabs remain available for this session if storage is unavailable.
    }
  }

  function show(value: string): void {
    setTabs(shown(tabs, chatId, value));
    if (value === WORKSPACE) setWorkspaceVisits((visits) => visits + 1);
    if (value === BROWSER) {
      const browserId = browsersOf(browsers, chatId).activeId;
      if (browserId) void window.kira.activateBrowser(chatId, browserId);
      else void window.kira.deactivateBrowser(chatId);
    }
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, value: string): void {
    const index = views.findIndex((view) => view.value === value);
    const nextIndex =
      event.key === 'ArrowDown'
        ? (index + 1) % views.length
        : event.key === 'ArrowUp'
          ? (index - 1 + views.length) % views.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? views.length - 1
              : -1;
    if (nextIndex === -1) return;

    event.preventDefault();
    const next = views[nextIndex];
    if (!next) return;
    tabRefs.current.get(next.value)?.focus();
    show(next.value);
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
        <div
          className="workbench-views"
          role="tablist"
          aria-label="Workbench views"
          aria-orientation="vertical"
        >
          {views.map((view) => (
            <Tooltip key={view.value} content={view.label} placement="start">
              <button
                ref={(element) => {
                  tabRefs.current.set(view.value, element);
                }}
                type="button"
                role="tab"
                aria-label={view.label}
                aria-selected={showing === view.value}
                aria-controls={panelOf(view.value)}
                tabIndex={showing === view.value ? 0 : -1}
                className="workbench-view"
                onClick={() => show(view.value)}
                onKeyDown={(event) => moveFocus(event, view.value)}
              >
                <Icon icon={view.icon} size="md" />
              </button>
            </Tooltip>
          ))}
        </div>
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
          className={`workbench-tab workbench-workspace${open.length > 0 ? ' has-open-files' : ''}`}
          hidden={showing !== WORKSPACE}
        >
          {open.length > 0 && (
            <div className="workbench-editor">
              <TabList
                value={selectedFile ? valueOf(selectedFile) : valueOf(open[0]!)}
                onChange={(next) => setTabs(shown(tabs, chatId, next))}
                hasDivider
                role="tablist"
                aria-label="Open files"
              >
                {open.map((path) => (
                  <Tooltip key={path} content={path} placement="below">
                    <Tab
                      value={valueOf(path)}
                      label={nameOf(path)}
                      panelId={panelOf(valueOf(path))}
                      className="workbench-file-tab"
                      ref={(element) => {
                        fileTabRefs.current.set(valueOf(path), element);
                      }}
                      endContent={
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
                        if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                        event.preventDefault();
                        closeFile(path);
                      }}
                    />
                  </Tooltip>
                ))}
              </TabList>
              <div className="workbench-editor-pages">
                {open.map((path) => (
                  <div
                    key={path}
                    id={panelOf(valueOf(path))}
                    role="tabpanel"
                    aria-label={path}
                    className="workbench-editor-page"
                    hidden={selectedFile !== path}
                  >
                    <FileTab
                      key={`${path}:${JSON.stringify(readings.get(readingKey(path)))}`}
                      chatId={chatId}
                      path={path}
                      reading={readings.get(readingKey(path))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          <section className="workbench-explorer" aria-label="Files">
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
                 * another view is showing, and not while the whole pane is put
                 * away, so a folder is never watched for a chat nobody is looking
                 * at (ADR 0016).
                 */
                showing={showing === WORKSPACE && !region.isCollapsed}
                onOpenFile={openFile}
              />
            ) : null}
          </section>
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
      const result = await window.kira.retryBreakdownReady();
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
