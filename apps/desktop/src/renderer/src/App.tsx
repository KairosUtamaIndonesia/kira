import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Button, type ButtonVariant } from '@astryxdesign/core/Button';
import { ChatMessage, ChatMessageBubble } from '@astryxdesign/core/Chat';
import { ContextMenu } from '@astryxdesign/core/ContextMenu';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Markdown } from '@astryxdesign/core/Markdown';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import {
  SideNav,
  SideNavCollapseButton,
  SideNavHeading,
  SideNavItem,
  useSideNavCollapse,
} from '@astryxdesign/core/SideNav';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { useClipboard } from '@astryxdesign/core/hooks';
import { useToast } from '@astryxdesign/core/Toast';
import {
  ActionBarPrimitive,
  AuiIf,
  AssistantRuntimeProvider,
  BranchPickerPrimitive,
  ExportedMessageRepository,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ExternalStoreAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import {
  ArrowLeft,
  ArrowUpDown,
  Brain,
  Check,
  CircleUserRound,
  Copy,
  Download,
  Folder,
  FolderPlus,
  GitFork,
  LogOut,
  MessageSquareDashed,
  MessagesSquare,
  PanelLeft,
  PanelRight,
  Pencil,
  Plug,
  RotateCcw,
  Settings2,
  Terminal,
  Ticket,
} from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { Composer } from './composer';
import { CHAT_SORT_LABELS, type ChatSort, relativeTime, sortChats } from './chatOrdering';
import { SignIn } from './signIn';
import { Workbench, useWorkbench } from './workbench';
import {
  browserElementSelectionForChat,
  BROWSER_ELEMENT_SELECTION_EVENT,
  type BrowserElementSelection,
} from './browser/elementSelection';
import type {
  AuthState,
  ChatMessage as ChatLine,
  ChatConclusion,
  ChatMode,
  ChatMemory,
  GlossaryChangeNote,
  ChatPart,
  ChatState,
  ChatSummary,
  ChatTranscript,
  ChatUsage,
  ModelOption,
  ShapingState,
  TicketQueue,
  WorkspaceSummary,
  QueuedLine,
  Result,
  Usage,
  QuestionnaireRequest,
  QuestionnaireResult,
} from '../../preload/bridge';
import { messagesShowingActions } from './lineActions';
import { CompactionBoundary, type Boundary } from './compactionBoundary';
import { Work } from './workTrace';
import { workPartsByMessage } from './workPresentation';
import { QuestionnaireCard, type QuestionnaireDraft } from './questionnaireCard';
import { WorkSurface } from './work';
import { WorkHome } from './workHome';
import SettingsPage, { type Setting } from './settings';
import type { ProposalVerdict } from './proposalCard';
import { approvedSpecTicket } from './specPane';

/**
 * Ids for the two messages the window holds before the database does: the
 * message just sent, and the reply being written. Both are replaced by what the
 * main process reports once the turn settles, so they only have to be unique
 * while they last.
 */
const PENDING_ID = 'pending-message';
const STREAMING_ID = 'streaming-reply';
const CHAT_SORT_STORAGE_KEY = 'foundry.chat-sort';
const CHAT_SORT_OPTIONS: ChatSort[] = ['recent', 'created', 'alphabetical'];
// Astryx's own floor (180px) truncates a chat row's title to one or two
// letters before its timestamp and menu even fit — 320px is the width a
// live resize check landed on where every row in this sidebar (a chat title
// with a timestamp trailing it, a workspace name) still reads in full.
const SIDEBAR_RESIZABLE = { autoSaveId: 'foundry.sidebar', minWidth: 320 };

/**
 * A pane that is parked — a new chat kept for its words while another chat is
 * read — is handed nothing to work with: it has no messages, so nothing in it
 * can ask for anything to be done. The runtime still asks for these, so they are
 * answered with a function that does nothing rather than left out.
 */
const NOTHING = async (): Promise<void> => {};

/** A chat Kira has proposed nothing in. */
const NO_SHAPING: ShapingState = { proposals: [] };

const PARKED_PANE: ComponentProps<typeof ChatPane> = {
  chatId: '',
  repository: ExportedMessageRepository.fromBranchableArray([], {
    headId: null,
  }),
  partsOf: new Map<string, readonly ChatPart[]>(),
  trailing: [],
  questionnaire: null,
  actionRows: new Set<string>(),
  isRunning: false,
  error: null,
  onNew: NOTHING,
  onEdit: NOTHING,
  onReload: NOTHING,
  onBranchChange: NOTHING,
  onFork: NOTHING,
  onCancel: NOTHING,
  usage: null,
  chatUsage: null,
  queued: [],
  restored: null,
  onTakeBack: NOTHING,
  onRestored: NOTHING,
  models: [],
  modelId: null,
  onChooseModel: NOTHING,
  browserElements: [],
  onBrowserElementsChange: NOTHING,
  onAddBrowserElement: NOTHING,
  onAnswerQuestionnaire: async () => null,
  onCancelQuestionnaire: async () => null,
  questionnaireDraft: undefined,
  onQuestionnaireDraftChange: () => {},
};

function readChatSort(): ChatSort {
  const stored = window.localStorage.getItem(CHAT_SORT_STORAGE_KEY);

  return stored === 'created' || stored === 'alphabetical' ? stored : 'recent';
}

/** A message just sent, and the chat it was sent in. */
interface Pending {
  chatId: string;
  message: ChatLine;
}

/**
 * Something that went wrong, and the chat it went wrong in.
 *
 * A failure is only shown in the conversation it happened in: a chat that is
 * being written in elsewhere can fail while the reader is somewhere else, and
 * the news belongs there, waiting, rather than over another chat's conversation.
 */
interface Trouble {
  chatId: string;
  message: string;
}

export default function App() {
  /**
   * Who is signed in, and null until the main process has said.
   *
   * Null is not the same as signed out: until the first answer there is nothing
   * to show and nothing worth starting, which is why the sign-in button waits.
   */
  const [auth, setAuth] = useState<AuthState | null>(null);
  /**
   * Which surface the window is showing. `work-home` navigates projects and `work`
   * reads one workspace's project queue — see `workHome.tsx` and `work.tsx`.
   */
  const [surface, setSurface] = useState<'chat' | 'settings' | 'work' | 'work-home'>('chat');
  /**
   * Which part of Settings the rail has selected. A place in a page rather than
   * anything the account decided, so it lasts while the window is in Settings and
   * a fresh launch begins at the account again.
   */
  const [setting, setSetting] = useState<Setting>('account');
  /**
   * The workspace whose work is on screen, or null when nothing has been opened.
   *
   * The work belongs to a folder, so which folder is being worked is a choice the
   * window makes and keeps: opening it from a workspace's own row is how it is
   * said, and the chat on screen is only the fallback — a chat filed under a
   * workspace is a reason to look at that workspace's work, not a decision about
   * it.
   */
  const [workWorkspaceId, setWorkWorkspaceId] = useState<string | null>(null);
  const [workTicketId, setWorkTicketId] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  /** The models Foundry offers, in the pool's order, as the picker lists them. */
  const [models, setModels] = useState<ModelOption[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [mode, setMode] = useState<ChatMode>('build');
  /** The model the chat on screen runs on, or null while it has chosen none. */
  const [modelId, setModelId] = useState<string | null>(null);
  /** What the chat on screen has used, or null when there is no session in it yet. */
  const [chatUsage, setChatUsage] = useState<ChatUsage | null>(null);
  const [shaping, setShaping] = useState<ShapingState>(NO_SHAPING);
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireRequest | null>(null);
  const [questionnaireDrafts, setQuestionnaireDrafts] = useState<
    Record<string, QuestionnaireDraft>
  >({});
  const [specQueue, setSpecQueue] = useState<TicketQueue | null>(null);
  const [specQueueChatId, setSpecQueueChatId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [chatSort, setChatSort] = useState<ChatSort>(readChatSort);
  const [transcript, setTranscript] = useState<ChatTranscript>({
    messages: [],
    trailing: [],
    headId: null,
  });
  const [running, setRunning] = useState<string[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [queued, setQueued] = useState<QueuedLine[]>([]);
  /** What Kira is holding for the chat on screen. */
  const [memory, setMemory] = useState<ChatMemory[]>([]);
  /** What Kira has worked out for it, which is drawn apart from what Kira holds. */
  const [conclusions, setConclusions] = useState<ChatConclusion[]>([]);
  const [restored, setRestored] = useState<string | null>(null);
  /** Browser elements attached to an unsent draft, kept with the chat that selected them. */
  const [browserElementsByChat, setBrowserElementsByChat] = useState<
    Record<string, BrowserElementSelection[]>
  >({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<Trouble | null>(null);
  /** The chat a delete is being confirmed for, or null when none is. */
  const [deleting, setDeleting] = useState<ChatSummary | null>(null);
  const toast = useToast();

  /*
   * Which chat's things the workbench holds is the chat on screen's business;
   * how wide it is and whether it is showing are the window's. So the region is
   * held here, where the header row's control and the pane can both reach it.
   */
  const workbench = useWorkbench();

  /*
   * The chat on screen, where the sidebar has it — a chat being composed is not
   * in the list yet, which is why the header names it by what it is — and what
   * the workbench calls the folder it is showing: a workspace's own name, or null
   * for a workspace Foundry made for the chat, which the pane names in words
   * because a folder named after a UUID says nothing to anyone.
   */
  const currentChat = chats.find((chat) => chat.id === currentId);
  const workspaceName =
    workspaces.find((workspace) => workspace.id === currentChat?.workspaceId)?.name ?? null;

  /**
   * The workspace whose work is on screen.
   *
   * The one that was opened, or failing that the one holding the chat on screen,
   * or failing that the first: a window whose folder was removed from under it —
   * or that has no folder at all — draws the surface's own "no folder" state
   * rather than nothing.
   */
  const worked =
    workspaces.find((workspace) => workspace.id === workWorkspaceId) ??
    workspaces.find((workspace) => workspace.id === currentChat?.workspaceId) ??
    workspaces[0] ??
    null;

  /**
   * Whether Kira is writing in the chat on screen. A chat that is running
   * elsewhere is not this one's business: its turn keeps going, and only the
   * sidebar says so.
   */
  const isRunning = running.includes(currentId);

  /**
   * Show the surface the main process read back, or why it could not be.
   *
   * The message sent optimistically is dropped here: by now the database holds
   * the question, and a second copy of it would be one message too many. A chat
   * that is being written in elsewhere arrives with its words so far, so opening
   * it shows the reply as it stands rather than an empty pane.
   */
  const showState = useCallback(
    async (result: Result<ChatState>) => {
      if (!result.ok) {
        setError({ chatId: currentId, message: result.error });
        return;
      }

      setChats(result.value.chats);
      setWorkspaces(result.value.workspaces);
      setCurrentId(result.value.currentId);
      setMode(result.value.mode);
      setDraftId(result.value.draftId);
      setTranscript(result.value.transcript);
      setModelId(result.value.modelId);
      setChatUsage(result.value.chatUsage);
      const nextShaping = result.value.shaping ?? NO_SHAPING;
      setShaping(nextShaping);
      setQuestionnaire(result.value.questionnaire ?? null);
      setSpecQueue(null);
      setSpecQueueChatId(null);
      const currentChat = result.value.chats.find((chat) => chat.id === result.value.currentId);
      const workspaceId = currentChat?.workspaceId;
      if (
        workspaceId !== null &&
        workspaceId !== undefined &&
        approvedSpecTicket(nextShaping) !== null
      ) {
        const queue = await window.foundry.loadQueue(workspaceId);
        if (queue.ok) {
          setSpecQueue(queue.value);
          setSpecQueueChatId(result.value.currentId);
        }
      }
      setRunning(result.value.running);
      setStreaming(result.value.streaming);
      setQueued(result.value.queued);
      setMemory(result.value.memory);
      setConclusions(result.value.conclusions);
      setPending(null);
    },
    [currentId],
  );

  const refresh = useCallback(async () => {
    await showState(await window.foundry.loadChat());
  }, [showState]);

  /**
   * Who is signed in, read once and then heard about.
   *
   * Both halves are needed. The read is what a window that opened after a
   * sign-in already finished sees, since the news of it was sent before there
   * was anything listening; the subscription is what a window already open sees
   * when a sign-in finishes in the browser.
   */
  useEffect(() => {
    const unsubscribe = window.foundry.onAuthEvent(setAuth);
    const stopUsage = window.foundry.onUsageEvent(setUsage);
    void window.foundry.loadAuth().then((result) => {
      setAuth(result.ok ? result.value : { signedIn: false });
    });
    // Read as well as listened for, for the same reason as the auth pair above:
    // the news of a reading that arrived before this window existed was sent to
    // nobody. A reading of null is "no reading", which draws nothing.
    void window.foundry.loadUsage().then((result) => {
      setUsage(result.ok ? result.value : null);
    });
    // The models the picker offers. Read here rather than carried in the chat
    // state, because the list is the same in every chat and only moves when the
    // server is asked again; which of them a chat runs on is in the chat state,
    // because that is the chat's own. Read once, so a model the pool drops while
    // the window is open stays on the list until Foundry is restarted — choosing
    // it is refused by the main process rather than quietly run.
    void window.foundry.loadModels().then((result) => {
      setModels(result.ok ? result.value : []);
    });

    return () => {
      unsubscribe();
      stopUsage();
    };
  }, []);

  const signIn = useCallback(() => {
    void window.foundry.signIn();
  }, []);

  const signOut = useCallback(() => {
    void window.foundry.signOut();
  }, []);

  function showSurface(next: 'chat' | 'settings' | 'work' | 'work-home'): void {
    setSurface(next);
  }

  useEffect(() => {
    const unsubscribe = window.foundry.onChatEvent((event) => {
      if (event.type === 'questionnaire-closed') {
        setQuestionnaireDrafts((drafts) => {
          const { [event.requestId]: _closed, ...remaining } = drafts;
          return remaining;
        });
      }
      // A turn in a chat the window is not showing is the sidebar's business:
      // nothing here draws it, and it matters only once it is over, which is
      // when the list — and which chats are running — is read again.
      if (event.threadId !== currentId) {
        // A turn beginning or ending elsewhere is the list's business: which
        // chats are running is part of what the list says.
        if (event.type === 'transcript' || event.type === 'started') {
          void refresh();
        }

        return;
      }

      // Words are being written in this chat. A chat composed a moment ago is
      // stored by now, so this is where the list — which did not have it — is
      // read again, and with it which chats are running where.
      if (event.type === 'started') {
        setRunning((ids) => (ids.includes(event.threadId) ? ids : [...ids, event.threadId]));
        void refresh();
        return;
      }

      if (event.type === 'progress') {
        setTranscript(event.transcript);
        return;
      }

      // Words waiting their turn belong to the chat that will read them: the
      // sidebar counts no queues, so another chat's are only read when it is.
      if (event.type === 'queued') {
        setQueued(event.queued);
        return;
      }

      if (event.type === 'shaping') {
        setShaping(event.shaping);
        return;
      }

      if (event.type === 'questionnaire-opened') {
        setQuestionnaire(event);
        return;
      }

      if (event.type === 'questionnaire-closed') {
        setQuestionnaire((open) => (open?.requestId === event.requestId ? null : open));
        return;
      }

      if (event.type === 'delta') {
        setRunning((ids) => (ids.includes(event.threadId) ? ids : [...ids, event.threadId]));
        // `beginsReply` starts a new line: one turn can be several messages, and
        // what was written before this one is already stored.
        setStreaming((text) =>
          event.beginsReply || text === null ? event.text : text + event.text,
        );
        return;
      }

      // The turn settled. What the database holds is authoritative: it replaces
      // the streamed text and the message shown optimistically, so nothing the
      // model did can leave the window disagreeing with the record. The list is
      // read again because the turn may have named this chat, moved it up, or
      // been the last thing running in it.
      setTranscript(event.transcript);
      setStreaming(null);
      setPending(null);
      void refresh();
    });

    void window.foundry.loadChat().then(showState);

    return unsubscribe;
  }, [currentId, refresh, showState]);

  /**
   * Ask Kira something, on the branch that ends at `from`.
   *
   * There is no guard against sending while a turn runs: the composer cannot be
   * sent then, and pi refuses a prompt mid-turn, which comes back as an error
   * rather than as two turns at once.
   */
  const send = useCallback(
    async (text: string, from: string | null): Promise<void> => {
      const sentIn = currentId;

      setError(null);
      setRunning((ids) => (ids.includes(sentIn) ? ids : [...ids, sentIn]));
      setStreaming(null);
      setPending({
        chatId: sentIn,
        message: {
          id: PENDING_ID,
          parentId: from,
          role: 'you',
          parts: [{ type: 'text', text }],
        },
      });

      const result = await window.foundry.sendMessage(text);

      if (!result.ok) {
        // Taking the message back only applies where it was sent: the window may
        // have moved on while this turn ran, and it would be clearing another
        // chat's words. The error waits with the chat it belongs to, because a
        // failure reads as one only in the conversation it happened in.
        setError({ chatId: sentIn, message: result.error });
        setPending((shown) => (shown?.chatId === sentIn ? null : shown));
      }

      // The message was never stored, or the turn is over: either way what the
      // database holds is what the window should show.
      await refresh();
    },
    [currentId, refresh],
  );

  /**
   * Run the chat on screen on another model.
   *
   * The change itself is the main process's to make — it holds the session and
   * the catalog — so this asks, and then reads the surface again: which model a
   * chat is on is part of that chat's state, and reading it is what says the
   * choice landed rather than this call's reply.
   */
  const chooseModel = useCallback(
    async (chosen: string): Promise<void> => {
      const result = await window.foundry.chooseModel(chosen);

      if (!result.ok) {
        setError({ chatId: currentId, message: result.error });
        return;
      }

      await refresh();
    },
    [currentId, refresh],
  );

  /** Change this chat's mode; the main process owns and persists the choice. */
  const chooseChatMode = useCallback(
    async (next: ChatMode): Promise<void> => {
      const result = await window.foundry.setChatMode(next);
      if (!result.ok) {
        setError({ chatId: currentId, message: result.error });
        return;
      }
      setMode(next);
      setError(null);
    },
    [currentId],
  );

  /** Stand on the branch ending at `messageId`, and carry on from there. */
  const switchBranch = useCallback(
    async (messageId: string | null): Promise<void> => {
      if (messageId === null) {
        return;
      }

      const result = await window.foundry.switchBranch(messageId);

      if (!result.ok) {
        setError({ chatId: currentId, message: result.error });
        // The window had already moved to the branch it was asked for, so read
        // the surface again to put it back where pi still stands.
        await refresh();
        return;
      }

      setError(null);
      setStreaming(null);
      await refresh();
    },
    [currentId, refresh],
  );

  /**
   * Say `text` in place of the message at `messageId`, and let Kira answer it.
   *
   * Editing and asking again are the same thing: pi is stood before the message,
   * so what is said next lands beside it. What was said before stays in the tree
   * as a branch to switch back to, which is what makes an edit not an overwrite.
   */
  const replace = useCallback(
    async (messageId: string, text: string): Promise<void> => {
      const replaced = transcript.messages.find((message) => message.id === messageId);
      const taken = await window.foundry.editMessage(messageId);

      if (!taken.ok) {
        setError({ chatId: currentId, message: taken.error });
        return;
      }

      await send(text, replaced?.parentId ?? null);
    },
    [currentId, send, transcript],
  );

  /** Ask the question again, as a second answer beside the first. */
  const regenerate = useCallback(
    async (parentId: string | null): Promise<void> => {
      if (parentId === null) {
        return;
      }

      const asked = transcript.messages.find((message) => message.id === parentId);
      const text = asked ? textOf(asked.parts) : '';

      if (text !== '') {
        await replace(parentId, text);
      }
    },
    [replace, transcript],
  );

  /** What the runtime draws: the stored tree, plus whatever is still in flight. */
  const drawn = useMemo(
    () =>
      withInFlight(
        transcript,
        pending?.chatId === currentId ? pending.message : null,
        streaming,
        running.includes(currentId),
      ),
    [currentId, pending, running, streaming, transcript],
  );

  /**
   * The tree, in the shape the runtime reads branches out of. Rebuilt whenever
   * the tree or the branch on screen changes, which is how both a streamed
   * reply and a settled turn reach the window.
   */
  const repository = useMemo(
    () =>
      ExportedMessageRepository.fromBranchableArray(
        drawn.messages.map((message) => ({
          message: messageLike(message),
          parentId: message.parentId,
        })),
        { headId: drawn.headId },
      ),
    [drawn],
  );

  /**
   * What each drawn message says, by its id. A message's parts reach the window
   * through the runtime, in the shape the runtime reads — but what a tool call
   * came to is not in that shape, so the transcript's own parts are what a
   * message is drawn from.
   */
  const partsOf = useMemo(() => workPartsByMessage(drawn.messages), [drawn]);

  /**
   * Which messages draw the row of actions under them — see
   * {@link messagesShowingActions} for why a turn does not draw more than one.
   */
  const actionRows = useMemo(() => messagesShowingActions(drawn.messages), [drawn]);

  /**
   * Do something to the stored surface, and read it back. A failure is shown in
   * the chat it happened to, which is not always the chat on screen — a row can
   * be acted on while another chat is being read. A success says nothing, because
   * the surface that comes back is the answer.
   */
  async function run<T>(action: () => Promise<Result<T>>, inChat = currentId): Promise<T | null> {
    const result = await action();

    if (!result.ok) {
      setError({ chatId: inChat, message: result.error });
      return null;
    }

    setError(null);
    await refresh();
    return result.value;
  }

  /**
   * One of the person's shaping acts, answered where it was asked: the server's
   * refusal goes back to the card or tab that asked, and a taken act reads the
   * chat again, which is what brings the tracker's tickets with it.
   */
  async function answer(action: () => Promise<Result<unknown>>): Promise<string | null> {
    const result = await action();
    if (!result.ok) return result.error;
    await refresh();
    return null;
  }

  function decideProposal(proposalId: string, verdict: ProposalVerdict): Promise<string | null> {
    return answer(() =>
      verdict === 'approve'
        ? window.foundry.approveProposal(proposalId)
        : verdict === 'reject'
          ? window.foundry.rejectProposal(proposalId)
          : window.foundry.sendBackOutcome(proposalId),
    );
  }

  /**
   * Choose a folder to work in, and remember it.
 The folder is chosen in the
   * main process — only it can open a picker — and a picker closed without a
   * choice answers nothing at all, which is not a failure to report.
   *
   * A folder nobody has joined to a project is taken straight to the work, where
   * the projects it could join are offered: opening a folder is what asks the
   * question, and leaving it to be found later means a folder that works nothing
   * and says nothing about it.
   */
  async function addWorkspace(): Promise<void> {
    const added = await run(() => window.foundry.addWorkspace());
    if (added === null) return;

    setWorkWorkspaceId(added.id);
    if (added.projectId === null) showSurface('work');
  }

  /** Look at one workspace's work: its project's queue, read three ways. */
  function openWork(workspaceId: string): void {
    setWorkWorkspaceId(workspaceId);
    setWorkTicketId(null);
    showSurface('work');
  }

  /** The Work action opens its project navigator, not a context-dependent queue. */
  function openWorkHome(): void {
    setWorkTicketId(null);
    showSurface('work-home');
  }

  /**
   * Give a project a local workspace when this machine has none yet.
   *
   * Choosing a folder remembers it before the project link is written. If the
   * link is refused, keep the workspace in the sidebar and leave the navigator
   * open so the person can retry without losing the project they chose.
   */
  async function linkProjectWorkspace(projectId: string): Promise<string | null> {
    const added = await window.foundry.addWorkspace();
    if (!added.ok) return added.error;
    if (added.value === null) return null;

    const workspace = added.value;
    setWorkspaces((held) =>
      held.some((each) => each.id === workspace.id)
        ? held.map((each) => (each.id === workspace.id ? workspace : each))
        : [...held, workspace],
    );

    if (workspace.projectId !== null && workspace.projectId !== projectId) {
      return `${workspace.name} already works another project. Choose a folder that is not linked to a different project.`;
    }

    const joined =
      workspace.projectId === projectId
        ? { ok: true as const, value: workspace }
        : await window.foundry.joinWorkspace(workspace.id, { kind: 'existing', projectId });
    if (!joined.ok) return joined.error;

    setWorkspaces((held) =>
      held.map((each) => (each.id === joined.value.id ? joined.value : each)),
    );
    setWorkWorkspaceId(joined.value.id);
    setWorkTicketId(null);
    showSurface('work');
    return null;
  }

  /**
   * Stop showing a workspace. Its chats keep their conversations, and keep working
   * where they were working: they are filed nowhere until they are filed again.
   */
  async function removeWorkspace(id: string): Promise<void> {
    await run(() => window.foundry.removeWorkspace(id));
  }

  /**
   * Put a chat away. It leaves the sidebar and keeps everything it holds, so
   * there is nothing to warn about: it is read again by its id. The menu says
   * the chat is "kept as it is" — a toast is how that promise is redeemed the
   * moment it might otherwise feel like a loss.
   */
  async function archiveChat(id: string): Promise<void> {
    await run(() => window.foundry.archiveChat(id), id);
    toast({
      body: 'Chat archived.',
      endContent: (
        <Button label="Undo" variant="ghost" size="sm" onClick={() => void restoreChat(id)} />
      ),
    });
  }

  /** Bring a chat back from being put away. */
  async function restoreChat(id: string): Promise<void> {
    await run(() => window.foundry.restoreChat(id), id);
  }

  /**
   * Throw a chat away, which is what the dialog was asking about. The dialog is
   * closed once the window has the answer — the chat is gone, or the reason it
   * could not be — so a refusal is never taken for a deletion.
   */
  async function deleteChat(id: string): Promise<void> {
    await run(() => window.foundry.deleteChat(id), id);
    setDeleting(null);
  }

  /**
   * Start a chat that works in a workspace's folder, or in a space of its own when
   * no workspace is named. A workspace's chats share its folder, which is the whole
   * point of one: the same files, the same instructions beside them.
   */
  async function startChat(workspaceId: string | null): Promise<void> {
    await switchChat(() => window.foundry.startChat(workspaceId));
  }

  /**
   * Change which chat is on screen, leaving the one it was on. A chat that is
   * being written in is left running rather than closed, so a turn survives a
   * look at another conversation.
   */
  async function switchChat(open: () => Promise<Result<null>>): Promise<void> {
    const result = await open();

    if (!result.ok) {
      setError({ chatId: currentId, message: result.error });
      return;
    }

    setError(null);
    setStreaming(null);
    setQueued([]);
    setRestored(null);
    setPending(null);
    setQuestionnaire(null);
    // Choosing a chat is leaving whatever else was on screen, the prototype
    // surface included — which would otherwise be a room with no door.
    setSurface('chat');
    await refresh();
  }

  /**
   * Start a chat holding this one's words up to `messageId`, and show it. The
   * chat being forked from stays where it is, branches and all.
   */
  async function forkFrom(messageId: string): Promise<void> {
    await switchChat(() => window.foundry.forkChat(messageId));
  }

  /**
   * Give Kira words to read at Kira's next step, or once this turn has finished.
   *
   * A chat answers one thing at a time — pi refuses a second prompt on a session
   * that is already answering — so words written mid-turn wait their turn rather
   * than being refused. Which turn that is, the sender chooses.
   */
  const give = useCallback(
    async (text: string, lane: QueuedLine['lane']): Promise<void> => {
      const wroteIn = currentId;
      const result = await window.foundry.queueMessage(text, lane);

      if (!result.ok) {
        setError({ chatId: wroteIn, message: result.error });
      }

      // The queue is read back rather than worked out here: Kira reaching a line
      // and someone steering Kira both move it while the turn keeps running.
      await refresh();
    },
    [currentId, refresh],
  );

  /**
   * Put words that came back into the box, where they can be changed. The
   * composer holds the draft, so it is told the words rather than rewritten here.
   */
  const handBack = useCallback((lines: QueuedLine[]): void => {
    if (lines.length > 0) {
      setRestored(lines.map((line) => line.text).join('\n\n'));
    }
  }, []);

  /** Take back the words still waiting to be read, so they can be said differently. */
  const takeBack = useCallback(async (): Promise<void> => {
    const result = await window.foundry.takeQueuedBack();

    if (!result.ok) {
      setError({ chatId: currentId, message: result.error });
      return;
    }

    setQueued([]);
    handBack(result.value);
  }, [currentId, handBack]);

  /**
   * Stop the reply being written here. What Kira has written stays — stopping
   * ends a reply rather than discarding it — and the words Kira had not reached
   * yet come back to the box, because stopping is how you change your mind.
   */
  async function stop(): Promise<void> {
    const result = await window.foundry.stopChat();

    if (!result.ok) {
      setError({ chatId: currentId, message: result.error });
      return;
    }

    setQueued([]);
    handBack(result.value);
  }

  /**
   * The chats filed nowhere: what is left over once a workspace has taken the
   * chats that belong to it. They keep the list they have always had.
   */
  const orderedChats = useMemo(() => sortChats(chats, chatSort), [chatSort, chats]);
  const unfiled = orderedChats.filter((chat) => chat.workspaceId === null);

  /**
   * One chat in the sidebar. A workspace's chats and the chats filed nowhere are
   * drawn the same way and can be put away or thrown away the same way, so the
   * row is made in one place for both lists.
   */
  const chatRow = (chat: ChatSummary) => (
    <ChatRow
      key={chat.id}
      chat={chat}
      isCurrent={chat.id === currentId}
      isRunning={running.includes(chat.id)}
      onOpen={() => void switchChat(() => window.foundry.openChat(chat.id))}
      onArchive={() => void archiveChat(chat.id)}
      onDelete={() => setDeleting(chat)}
    />
  );

  function chooseChatSort(sort: ChatSort): void {
    setChatSort(sort);
    window.localStorage.setItem(CHAT_SORT_STORAGE_KEY, sort);
  }

  /**
   * Ask Kira something from the box, handing Kira's words to the runtime in its own
   * shape. Sending mid-turn is answered by the queue rather than refused: which
   * turn the words wait for is the sender's choice, so Alt+Enter holds them to
   * the end of this one and Enter hands them over at Kira's next step.
   */
  const onNew = useCallback<NonNullable<ExternalStoreAdapter<ChatLine>['onNew']>>(
    async (message) => {
      const text = textOf(message.content);

      if (text.trim() === '') {
        return;
      }

      if (isRunning) {
        await give(text, message.steer === false ? 'later' : 'next');
        return;
      }

      await send(text, transcript.headId);
    },
    [give, isRunning, send, transcript.headId],
  );

  /** Save a changed message, which says it again beside the words it replaces. */
  const onEdit = useCallback<NonNullable<ExternalStoreAdapter<ChatLine>['onEdit']>>(
    async (message) => {
      const text = textOf(message.content).trim();

      if (message.sourceId !== null && text !== '') {
        await replace(message.sourceId, text);
      }
    },
    [replace],
  );

  const onBranchChange = useCallback(
    (headId: string | null): void => void switchBranch(headId),
    [switchBranch],
  );
  const onRestored = useCallback(() => setRestored(null), []);

  /** What the pane on screen is handed, whichever chat that pane is for. */
  const paneProps: ComponentProps<typeof ChatPane> = {
    chatId: currentId,
    repository,
    partsOf,
    trailing: drawn.trailing,
    actionRows,
    questionnaire,
    questionnaireDraft: questionnaire ? questionnaireDrafts[questionnaire.requestId] : undefined,
    onQuestionnaireDraftChange: (requestId, draft) =>
      setQuestionnaireDrafts((drafts) => ({ ...drafts, [requestId]: draft })),
    isRunning,
    error: error?.chatId === currentId ? error.message : null,
    onNew,
    onEdit,
    onReload: regenerate,
    onBranchChange,
    onFork: forkFrom,
    onCancel: stop,
    usage,
    chatUsage,
    queued,
    restored,
    onTakeBack: takeBack,
    onRestored,
    onAnswerQuestionnaire: async (threadId, requestId, result) => {
      const answered = await window.foundry.answerQuestionnaire(threadId, requestId, result);
      return answered.ok ? null : answered.error;
    },
    onCancelQuestionnaire: async (threadId, requestId) => {
      const cancelled = await window.foundry.cancelQuestionnaire(threadId, requestId);
      return cancelled.ok ? null : cancelled.error;
    },
    models,
    modelId,
    onChooseModel: chooseModel,
    browserElements: browserElementsByChat[currentId] ?? [],
    onBrowserElementsChange: (browserElements) =>
      setBrowserElementsByChat((held) => ({ ...held, [currentId]: browserElements })),
    onAddBrowserElement: (selection) =>
      setBrowserElementsByChat((held) => ({
        ...held,
        [currentId]: [...(held[currentId] ?? []), selection],
      })),
  };

  /**
   * A new chat not yet said anything in is on screen in place of a stored chat,
   * but it has no row of its own to be picked from the sidebar again. So its pane
   * is kept mounted, hidden, while another chat is read: the runtime holding the
   * words in its box is what survives the trip, and nothing else remembers them.
   */
  const draftShown = draftId !== null && draftId === currentId;

  /*
   * A machine that is not signed in has no chat surface to draw: nothing there
   * can reach a model without a key, and signing in happens in the browser. So
   * the window is the sign-in until the app has a key, and becomes the chat
   * again the moment it has one.
   */
  if (auth === null || !auth.signedIn) {
    return <SignIn known={auth !== null} onSignIn={signIn} />;
  }

  return (
    <>
      <AppShell
        contentPadding={0}
        variant="elevated"
        sideNav={
          surface === 'settings' ? (
            // Settings is a mode of its own rather than one more row in the chat
            // rail: the chats and workspaces are not there to be browsed while
            // somebody is in Settings, so the whole rail becomes Settings'
            // instead of just the content beside it.
            <SideNav
              header={<SideNavHeading heading="Settings" icon={<FoundryMark />} />}
              collapsible
              resizable={SIDEBAR_RESIZABLE}
              footer={
                <AccountMenu
                  name={auth.user.name}
                  onOpenSettings={() => showSurface('settings')}
                  onSignOut={signOut}
                />
              }
              topContent={<SettingsNavActions onBack={() => showSurface('chat')} />}
            >
              {/*
               * What Settings holds, as rows. The rail is Settings' own while somebody
               * is in it, so its parts are chosen here instead of being scrolled past
               * on one page. Each row carries an icon because a collapsed rail draws
               * icons only — the same reason the chat rail's items have them.
               */}
              <SideNavItem
                label="Account"
                icon={CircleUserRound}
                isSelected={setting === 'account'}
                onClick={() => setSetting('account')}
              />
              <SideNavItem
                label="Memory"
                icon={Brain}
                isSelected={setting === 'memory'}
                onClick={() => setSetting('memory')}
              />
              <SideNavItem
                label="MCP servers"
                icon={Plug}
                isSelected={setting === 'mcp'}
                onClick={() => setSetting('mcp')}
              />
              <SideNavItem
                label="Updates"
                icon={Download}
                isSelected={setting === 'updates'}
                onClick={() => setSetting('updates')}
              />
              <SideNavItem
                label="Shell"
                icon={Terminal}
                isSelected={setting === 'shell'}
                onClick={() => setSetting('shell')}
              />
            </SideNav>
          ) : (
            <SideNav
              header={<FoundrySideNavHeader />}
              collapsible={{ hasButton: false }}
              resizable={SIDEBAR_RESIZABLE}
              // Settings and sign out both belong to the account using this window
              // rather than to any one chat, so they share one menu at the foot of
              // the nav instead of a permanent row apiece — the account's own
              // name and initial are what opens it, in place of a plain label.
              footer={
                <AccountMenu
                  name={auth.user.name}
                  onOpenSettings={() => showSurface('settings')}
                  onSignOut={signOut}
                />
              }
              topContent={
                // Never disabled: a new chat starts beside whatever Kira is writing
                // in, which is the point of a chat being a session of its own.
                <NavActions
                  chatSort={chatSort}
                  onNewChat={() => void startChat(null)}
                  onNewWorkspace={() => void addWorkspace()}
                  onOpenWork={openWorkHome}
                  onChooseSort={chooseChatSort}
                />
              }
            >
              {/*
               * Workspaces first: a workspace is set up on purpose, so the chats filed
               * nowhere are what is left over. A workspace is drawn even with no chats
               * in it, because a folder chosen to work in is a workspace already.
               *
               * A workspace is a disclosure row rather than a heading over its chats,
               * because that is the one shape a collapsed rail can draw: the rail
               * shows icons, and only an item that owns its chats can offer them in
               * the flyout it opens there.
               */}
              {workspaces.map((workspace) => {
                const workspaceChats = orderedChats.filter(
                  (chat) => chat.workspaceId === workspace.id,
                );
                // A workspace with a turn in flight keeps its menu down to what it can
                // still do: the chat is filed under it, and there is nothing to take
                // the filing out of while it runs.
                const writing = workspaceChats.some((chat) => running.includes(chat.id));

                return (
                  // SideNavItem doesn't expose a hook for styling its own children
                  // gutter (className lands on the primary element, not the
                  // disclosure wrapper) — this div is what .workspace-group in
                  // styles.css uses to draw the tree lines under a workspace without
                  // touching the unfiled Chats list below, which keeps Astryx's
                  // default indent but skips the lines.
                  <div className="workspace-group" key={workspace.id}>
                    <SideNavItem
                      label={workspace.name}
                      icon={Folder}
                      // Marking the workspace is how the collapsed rail says which one holds
                      // the chat on screen. It carries aria-current as well, which is
                      // slightly more than the truth — the chat is current, not the
                      // folder holding it.
                      isSelected={workspaceChats.some((chat) => chat.id === currentId)}
                      collapsible
                      actions={
                        <MoreMenu
                          label={`What to do with ${workspace.name}`}
                          items={[
                            {
                              label: 'Open the work',
                              onClick: () => openWork(workspace.id),
                            },
                            {
                              label: 'New chat here',
                              onClick: () => void startChat(workspace.id),
                            },
                            ...(writing
                              ? []
                              : [
                                  {
                                    label: 'Remove workspace',
                                    onClick: () => void removeWorkspace(workspace.id),
                                  },
                                ]),
                          ]}
                        />
                      }
                    >
                      {workspaceChats.length > 0 ? (
                        workspaceChats.map(chatRow)
                      ) : (
                        // A workspace is drawn open with nothing in it before its first
                        // chat, which otherwise looks like a disclosure that leads
                        // nowhere — this is what tells someone the "..." above is
                        // where to start one.
                        <Text type="supporting" color="secondary" className="empty-workspace">
                          No chats yet — use the menu above to start one.
                        </Text>
                      )}
                    </SideNavItem>
                  </div>
                );
              })}

              {unfiled.length > 0 && (
                // Unwrapped from a workspace, so nothing here is nested under
                // anything else — .unfiled-chats in styles.css zeroes out
                // Astryx's default disclosure indent to say so visually too.
                <div className="unfiled-chats">
                  <SideNavItem
                    label="Chats"
                    icon={MessagesSquare}
                    collapsible
                    // The order the list is read in sits with the list, in the row
                    // that heads it. Astryx draws a row's actions after its chevron,
                    // which is why this is not the left of it.
                    actions={<SortMenu chatSort={chatSort} onChooseSort={chooseChatSort} />}
                  >
                    {unfiled.map(chatRow)}
                  </SideNavItem>
                </div>
              )}
            </SideNav>
          )
        }
      >
        {surface === 'settings' ? (
          <SettingsPage
            user={auth.user}
            models={models}
            workspaces={workspaces}
            showing={setting}
          />
        ) : surface === 'work-home' ? (
          <WorkHome
            workspaces={workspaces}
            onOpenWorkspace={openWork}
            onLinkWorkspace={linkProjectWorkspace}
          />
        ) : surface === 'work' ? (
          <WorkSurface
            // The project is part of the key as well as the folder: joining one is
            // the same workspace with a different answer, and the surface has to be
            // built again to read the queue it did not have a moment ago.
            key={`${worked?.id ?? 'no-workspace'}:${worked?.projectId ?? 'no-project'}:${workTicketId ?? 'no-ticket'}`}
            workspace={worked}
            auth={auth}
            initialTicketId={workTicketId}
            onBack={() => showSurface('work-home')}
            // A run's chat is a chat, so the ticket hands the window to it rather than
            // drawing the run's words a second time in the panel (GH #68).
            chatIds={chats.map((each) => each.id)}
            onOpenChat={(chatId) => void switchChat(() => window.foundry.openChat(chatId))}
            onJoined={(joined) =>
              setWorkspaces((held) => held.map((each) => (each.id === joined.id ? joined : each)))
            }
          />
        ) : (
          <div className="chat">
            {/*
             * The row over the conversation: which chat this is, and the one
             * control for the pane beside it. A chat nobody has said anything in
             * yet has no title of its own — it has no row in the sidebar either —
             * so it is named by what it is.
             */}
            <div className="chat-header">
              <div className="chat-heading">
                <Text type="label" weight="medium" maxLines={1}>
                  {currentChat?.title ?? 'New chat'}
                </Text>
                <fieldset className="chat-mode-switcher" aria-label="Chat mode">
                  <Button
                    label="Build"
                    size="sm"
                    variant={mode === 'build' ? 'primary' : 'ghost'}
                    aria-pressed={mode === 'build'}
                    isDisabled={isRunning}
                    onClick={() => void chooseChatMode('build')}
                  />
                  <Button
                    label="Spec"
                    size="sm"
                    variant={mode === 'spec' ? 'primary' : 'ghost'}
                    aria-pressed={mode === 'spec'}
                    isDisabled={isRunning}
                    onClick={() => void chooseChatMode('spec')}
                  />
                </fieldset>
              </div>
              <IconButton
                className="workbench-toggle"
                label={workbench.isCollapsed ? 'Show the workbench' : 'Hide the workbench'}
                icon={<Icon icon={PanelRight} size="sm" />}
                aria-expanded={!workbench.isCollapsed}
                onClick={workbench.isCollapsed ? workbench.expand : workbench.collapse}
              />
            </div>

            <div className="chat-body">
              {/*
               * A new chat that has not been said anything in yet: no stored row, and
               * no place in the sidebar. It is hidden rather than unmounted while
               * another chat is read, so the box keeps what was typed in it — and when
               * it is the pane on screen it is handed exactly what any chat is, because
               * the first message sent in it is what makes it a chat.
               */}
              {draftId !== null && (
                <div className="draft-pane" hidden={!draftShown}>
                  <ChatPane key={draftId} {...(draftShown ? paneProps : PARKED_PANE)} />
                </div>
              )}

              {/*
               * A runtime per chat, and created here rather than in App, because the
               * runtime is what remembers a tree: it keeps the order it first met each
               * message in, and two chats can hold the same message — a fork copies
               * the chat it came from, ids and all. Showing a fork and then its source
               * would leave the source's other replies numbered from when the fork
               * introduced them, which is not the order a fresh window reads, so the
               * picker would count branches by what was on screen before.
               */}
              {!draftShown && <ChatPane key={currentId} {...paneProps} />}

              {/*
               * What Kira is holding for the chat on screen, beside the conversation
               * rather than in it: read, never said, so looking at Kira's memory is not a
               * turn and costs nothing.
               */}
              <Workbench
                region={workbench}
                memory={memory}
                conclusions={conclusions}
                chatId={currentId}
                composing={draftShown}
                workspaceName={workspaceName}
                shaping={shaping}
                ticketQueue={specQueueChatId === currentId ? specQueue : null}
                onDecide={decideProposal}
                onOpenWork={(ticket) => {
                  setWorkWorkspaceId(currentChat?.workspaceId ?? null);
                  setWorkTicketId(ticket.id);
                  setSurface('work');
                }}
              />
            </div>
          </div>
        )}
      </AppShell>

      {/*
       * Throwing a chat away cannot be taken back, so it is asked about first —
       * in the window's own words rather than the browser's, because what goes
       * is the conversation and what stays is the folder it worked in.
       */}
      {deleting && (
        <AlertDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) {
              setDeleting(null);
            }
          }}
          title="Delete this chat?"
          description="The conversation and everything said in it are deleted, and this cannot be undone. The folder it worked in is left as it is."
          actionLabel="Delete chat"
          onAction={() => void deleteChat(deleting.id)}
        />
      )}
    </>
  );
}

/**
 * Foundry's mark in the one place the wordmark isn't: the collapsed rail hides
 * `SideNavHeading`'s text and shows only its `icon` slot, which is otherwise
 * empty. Built from theme tokens — the accent color and the square corners the
 * theme already commits to — rather than a drawn asset, since there isn't one.
 */
function FoundryMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      F
    </span>
  );
}

function FoundrySideNavHeader() {
  const { isCollapsed } = useSideNavCollapse();

  return (
    <div className={isCollapsed ? 'side-nav-header side-nav-header-collapsed' : 'side-nav-header'}>
      <SideNavHeading heading="Foundry" icon={<FoundryMark />} />
      <SideNavCollapseButton>
        <Icon icon={PanelLeft} size="sm" />
      </SideNavCollapseButton>
    </div>
  );
}

/**
 * Settings and sign out are both about the account signed into this window
 * rather than about any one chat, so they share the one place in the rail
 * that already names that account instead of each keeping a permanent row.
 * The trigger is the account's own name and initial — not a plain label —
 * so opening the menu also answers "who am I signed in as" without a second
 * glance at Settings. It opens upward: this sits at the foot of the rail,
 * with nothing below it to open into.
 */
function AccountMenu({
  name,
  onOpenSettings,
  onSignOut,
}: {
  name: string;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const { isCollapsed } = useSideNavCollapse();
  const items = [
    {
      label: 'Settings',
      icon: <Icon icon={Settings2} size="sm" />,
      onClick: onOpenSettings,
    },
    {
      label: 'Sign out',
      icon: <Icon icon={LogOut} size="sm" />,
      onClick: onSignOut,
    },
  ];

  // Collapsed, there's no row width for the name or the disclosure chevron
  // to sit in — isIconOnly is the same square-button treatment the other
  // rail actions take collapsed (see NavActions, SortMenu), so the avatar
  // centers the way theirs does instead of keying off name/chevron layout
  // that isn't there.
  if (isCollapsed) {
    return (
      <DropdownMenu
        placement="above"
        button={{
          label: `${name}, account menu`,
          icon: <AccountAvatar name={name} />,
          isIconOnly: true,
          variant: 'ghost',
        }}
        items={items}
      />
    );
  }

  return (
    <DropdownMenu
      placement="above"
      button={{
        label: `${name}, account menu`,
        icon: <AccountAvatar name={name} />,
        children: name,
        variant: 'ghost',
        width: '100%',
        className: 'account-menu-trigger',
      }}
      items={items}
    />
  );
}

/**
 * The signed-in account's initial, drawn the same square way as `FoundryMark`
 * so both read as the rail's two identity marks — but in a neutral fill,
 * since this one names a person rather than the product.
 */
function AccountAvatar({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span className="account-avatar" aria-hidden="true">
      {initial}
    </span>
  );
}

/**
 * One chat on screen: the runtime that reads its tree, and the thread it draws.
 *
 * Remounted per chat, so a runtime never reads one chat's tree in terms of
 * another's — see where this is used for why that matters.
 */
/**
 * What you do to the list itself: start a chat, start a workspace. The nav column
 * has room for both labels, so they are rows there; the collapsed rail does not,
 * so the same two are icon-only buttons that their label names. The order the list
 * is read in travels with them — see SortMenu for why it is drawn in both places.
 */
/**
 * Settings' one way out, drawn where the chat rail draws its own primary
 * actions — an icon alone when the rail is collapsed, a labelled row when it
 * is not.
 */
function SettingsNavActions({ onBack }: { onBack: () => void }) {
  const { isCollapsed } = useSideNavCollapse();

  if (isCollapsed) {
    return (
      <div className="nav-actions">
        <IconButton
          label="Back to chat"
          icon={<Icon icon={ArrowLeft} size="sm" />}
          onClick={onBack}
        />
      </div>
    );
  }

  return (
    <div className="nav-actions nav-actions-expanded">
      <Button
        label="Back to chat"
        icon={<Icon icon={ArrowLeft} size="sm" />}
        variant="ghost"
        width="100%"
        onClick={onBack}
      />
    </div>
  );
}

function NavActions({
  chatSort,
  onNewChat,
  onNewWorkspace,
  onOpenWork,
  onChooseSort,
}: {
  chatSort: ChatSort;
  onNewChat: () => void;
  onNewWorkspace: () => void;
  onOpenWork: () => void;
  onChooseSort: (sort: ChatSort) => void;
}) {
  const { isCollapsed } = useSideNavCollapse();

  if (isCollapsed) {
    return (
      <div className="nav-actions">
        <IconButton
          label="New chat"
          icon={<Icon icon={MessageSquareDashed} size="sm" />}
          variant="primary"
          onClick={onNewChat}
        />
        <IconButton
          label="New workspace"
          icon={<Icon icon={FolderPlus} size="sm" />}
          variant="secondary"
          onClick={onNewWorkspace}
        />
        <IconButton
          label="Work"
          icon={<Icon icon={Ticket} size="sm" />}
          variant="ghost"
          onClick={onOpenWork}
        />
        <SortMenu chatSort={chatSort} onChooseSort={onChooseSort} variant="secondary" />
      </div>
    );
  }

  return (
    <div className="nav-actions nav-actions-expanded">
      <Button
        label="New chat"
        icon={<Icon icon={MessageSquareDashed} size="sm" />}
        variant="primary"
        width="100%"
        onClick={onNewChat}
      />
      <Button
        label="New workspace"
        icon={<Icon icon={FolderPlus} size="sm" />}
        variant="ghost"
        width="100%"
        onClick={onNewWorkspace}
      />
      <Button
        label="Work"
        icon={<Icon icon={Ticket} size="sm" />}
        variant="ghost"
        width="100%"
        onClick={onOpenWork}
      />
      {/*
       * The work is a workspace's own: a project's tickets are read from the row
       * that works them, which is why there is no entry for it up here.
       */}
    </div>
  );
}

/**
 * The order the list is read in. Icon-only wherever it is drawn, because neither
 * place has room for a label: the rail is a strip of icons, and in the Chats row
 * it sits beside that row's chevron. What names it is the tooltip, which is also
 * the button's accessible name.
 */
function SortMenu({
  chatSort,
  onChooseSort,
  variant = 'ghost',
}: {
  chatSort: ChatSort;
  onChooseSort: (sort: ChatSort) => void;
  variant?: ButtonVariant;
}) {
  const label = `Sort: ${CHAT_SORT_LABELS[chatSort]}`;

  return (
    <DropdownMenu
      button={{
        label,
        icon: <Icon icon={ArrowUpDown} size="sm" />,
        isIconOnly: true,
        variant,
        tooltip: label,
      }}
      items={CHAT_SORT_OPTIONS.map((sort) => ({
        id: sort,
        label: CHAT_SORT_LABELS[sort],
        onClick: () => onChooseSort(sort),
        endContent: sort === chatSort ? <span aria-hidden>✓</span> : undefined,
      }))}
    />
  );
}

/**
 * One chat in the sidebar. The same row belongs to a workspace and to nobody, so
 * it is drawn the same way in both lists.
 */
function ChatRow({
  chat,
  isCurrent,
  isRunning,
  onOpen,
  onArchive,
  onDelete,
}: {
  chat: ChatSummary;
  isCurrent: boolean;
  isRunning: boolean;
  onOpen: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  // A chat Kira is writing in is neither put away nor thrown away, so both rows
  // say why rather than being missing from the menu.
  const writing = isRunning ? 'Kira is writing in this chat.' : undefined;

  // The menu trigger only shows on hover/focus so a list of many chats doesn't
  // read as a wall of buttons — but its popover content renders outside this
  // row (through the Layer system), so :focus-within stops matching the
  // instant focus moves into the open menu. Track open state explicitly so
  // the trigger stays visible for as long as the menu it opened is up.
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Shared with the row's visible menu below: right-click is a shortcut to the
  // same two things, not a second set of them.
  const items = [
    {
      label: 'Archive',
      // What putting a chat away leaves behind is out of sight, so the menu
      // says what it did rather than leaving it to be guessed at.
      description: writing ?? 'Out of the sidebar, kept as it is.',
      isDisabled: isRunning,
      onClick: onArchive,
    },
    {
      label: 'Delete',
      description: writing,
      variant: 'destructive' as const,
      isDisabled: isRunning,
      onClick: onDelete,
    },
  ];

  return (
    <ContextMenu label={`What to do with ${chat.title}`} items={items}>
      {/* SideNavItem forwards `className` to its own internal primary element,
          whose later focus-ring props silently overwrite it — so the
          hover/focus-reveal hook for the row's menu (see .chat-row in
          styles.css) lives on a wrapper we control instead. */}
      <div className={`chat-row${isMenuOpen ? ' chat-row-menu-open' : ''}`}>
        <SideNavItem
          label={chat.title}
          // A run is a chat in every other way, so the one thing that tells them apart is
          // drawn rather than written: a ticket beside a row means this chat is a run of it
          // rather than a conversation somebody had (GH #68).
          icon={chat.ticketId === null ? undefined : Ticket}
          isSelected={isCurrent}
          // A chat Kira is writing in is marked, because that keeps going whether or
          // not this window is showing it. Otherwise, when a chat's title is not
          // enough to tell it from another (two chats can share a title), how long
          // ago it was last spoken in is.
          endContent={
            isRunning ? (
              <Spinner size="sm" shade="subtle" aria-label="Kira is writing" />
            ) : (
              <Text type="supporting">{relativeTime(chat.updatedAt)}</Text>
            )
          }
          // Right-click reaches the same menu, but nothing on the row hinted that
          // until now: this is the visible entry point, matching the "..." a
          // workspace already offers for the same kind of decision.
          actions={
            <MoreMenu
              label={`What to do with ${chat.title}`}
              items={items}
              onOpenChange={setIsMenuOpen}
            />
          }
          onClick={onOpen}
        />
      </div>
    </ContextMenu>
  );
}

function ChatPane({
  chatId,
  repository,
  partsOf,
  trailing,
  questionnaire,
  questionnaireDraft,
  onQuestionnaireDraftChange,
  actionRows,
  isRunning,
  error,
  onNew,
  onEdit,
  onReload,
  onBranchChange,
  onFork,
  onCancel,
  usage,
  chatUsage,
  models,
  modelId,
  onChooseModel,
  browserElements,
  onBrowserElementsChange,
  onAddBrowserElement,
  queued,
  restored,
  onTakeBack,
  onRestored,
  onAnswerQuestionnaire,
  onCancelQuestionnaire,
}: {
  chatId: string;
  repository: ReturnType<typeof ExportedMessageRepository.fromBranchableArray>;
  /** What each drawn message says, by its id: the parts the window draws. */
  partsOf: Map<string, readonly ChatPart[]>;
  questionnaire: QuestionnaireRequest | null;
  questionnaireDraft: QuestionnaireDraft | undefined;
  onQuestionnaireDraftChange: (requestId: string, draft: QuestionnaireDraft) => void;
  /**
   * Boundaries that no message carries, because nothing has been said since
   * them: a chat compacted a moment ago and not yet carried on. Drawn at the end
   * of the column, which is where a reader meets them.
   */
  trailing: readonly ChatPart[];
  /** Messages that draw the row of actions under them, by id. */
  actionRows: Set<string>;
  isRunning: boolean;
  error: string | null;
  /** What this person has used of their allowance this month, or no reading. */
  usage: Usage | null;
  /** What the chat on screen has used, or null when there is no session in it yet. */
  chatUsage: ChatUsage | null;
  /** The models Foundry offers, in the pool's order. */
  models: ModelOption[];
  /** The model this chat runs on, or null while it has chosen none. */
  modelId: string | null;
  onChooseModel: (modelId: string) => Promise<void>;
  browserElements: BrowserElementSelection[];
  onBrowserElementsChange: (browserElements: BrowserElementSelection[]) => void;
  onAddBrowserElement: (selection: BrowserElementSelection) => void;
  // Whatever the runtime asks of a window that owns its own messages: the
  // shapes are the adapter's, so there is one place they can drift from.
  onNew: NonNullable<ExternalStoreAdapter<ChatLine>['onNew']>;
  onEdit: NonNullable<ExternalStoreAdapter<ChatLine>['onEdit']>;
  onReload: NonNullable<ExternalStoreAdapter<ChatLine>['onReload']>;
  onBranchChange: (headId: string | null) => void;
  onFork: (messageId: string) => Promise<void>;
  onCancel: () => Promise<void>;
  queued: QueuedLine[];
  restored: string | null;
  onTakeBack: () => Promise<void>;
  onRestored: () => void;
  onAnswerQuestionnaire: (
    threadId: string,
    requestId: string,
    result: QuestionnaireResult,
  ) => Promise<string | null>;
  onCancelQuestionnaire: (threadId: string, requestId: string) => Promise<string | null>;
}) {
  const runtime = useExternalStoreRuntime<ChatLine>({
    messageRepository: repository,
    // The runtime's adapter requires a converter of our message type even though
    // the repository is what carries the branches — nothing here converts twice.
    convertMessage: messageLike,
    isRunning,
    onNew,
    onEdit,
    onReload,
    // Handing this over is what tells the runtime a run can be stopped, so the
    // composer's stop button only appears while one is actually running.
    onCancel,
    // What lets the runtime switch branches. The window keeps no messages of its
    // own, so the list it hands back here is dropped and the tree is read again
    // from the main process, where it actually lives.
    setMessages: () => {},
    unstable_onBranchChange: ({ headId }) => onBranchChange(headId),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <BrowserElementSelectionListener
        key={chatId}
        chatId={chatId}
        onSelect={onAddBrowserElement}
      />
      <ThreadPrimitive.Root className="thread">
        <ThreadPrimitive.Viewport className="thread-viewport">
          <div className="thread-viewport-inner">
            <AuiIf condition={(state) => state.thread.isEmpty}>
              <Text color="secondary">Send a message to start.</Text>
            </AuiIf>
            <ThreadPrimitive.Messages>
              {({ message }) => {
                const parts = partsOf.get(message.id) ?? [];
                const showsActions = actionRows.has(message.id);
                if (parts.length === 0 && !showsActions) return null;

                return (
                  <Line
                    isKira={message.role === 'assistant'}
                    messageId={message.id}
                    parts={parts}
                    isWorking={isRunning && message.isLast}
                    isEditing={message.composer.isEditing}
                    showsActions={showsActions}
                    onFork={onFork}
                  />
                );
              }}
            </ThreadPrimitive.Messages>
            {questionnaire ? (
              <QuestionnaireCard
                key={questionnaire.requestId}
                request={questionnaire}
                draft={questionnaireDraft}
                onDraftChange={onQuestionnaireDraftChange}
                onSubmit={onAnswerQuestionnaire}
                onCancel={onCancelQuestionnaire}
              />
            ) : null}
            {trailing.length === 0 ? null : boundariesIn(trailing)}
          </div>
        </ThreadPrimitive.Viewport>

        <ThreadPrimitive.ViewportFooter className="thread-footer">
          <Composer
            placeholder="Tell Kira what to do in this folder"
            error={error}
            usage={usage}
            chatUsage={chatUsage}
            models={models}
            modelId={modelId}
            onChoose={(chosen) => void onChooseModel(chosen)}
            queued={queued}
            restored={restored}
            onTakeBack={onTakeBack}
            onRestored={onRestored}
            browserElements={browserElements}
            onBrowserElementsChange={onBrowserElementsChange}
          />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

function BrowserElementSelectionListener({
  chatId,
  onSelect,
}: {
  chatId: string;
  onSelect: (selection: BrowserElementSelection) => void;
}) {
  useMountEffect(() => {
    const receive = (event: Event): void => {
      const selection = browserElementSelectionForChat(
        (event as CustomEvent<unknown>).detail,
        chatId,
      );
      if (selection !== null) onSelect(selection);
    };
    window.addEventListener(BROWSER_ELEMENT_SELECTION_EVENT, receive);
    return () => window.removeEventListener(BROWSER_ELEMENT_SELECTION_EVENT, receive);
  });
  return null;
}

/**
 * Everything a bubble can hold. A boundary stands outside one, not in it.
 */
type SaidPart = Exclude<ChatPart, { type: 'compaction' }>;

/** Whether a part is a boundary rather than something somebody said. */
function isBoundary(part: ChatPart): part is Boundary {
  return part.type === 'compaction';
}

/** What a message's bubble holds: whatever was said, without the boundaries. */
function saidIn(parts: readonly ChatPart[]): SaidPart[] {
  return parts.filter((part): part is SaidPart => !isBoundary(part));
}

/**
 * The boundaries in `parts`, as the window draws them: outside the bubble, each
 * standing above the message it hands over to. Read in two places — the parts a
 * message carries, and the ones left at the end of a chat — so that they are drawn
 * the same way either way.
 */
function boundariesIn(parts: readonly ChatPart[]): ReactNode {
  return parts.filter(isBoundary).map((part) => <CompactionBoundary key={part.at} part={part} />);
}

/**
 * One message: where it sits and what it can do are assistant-ui's, what it
 * looks like is Astryx's.
 */
function Line({
  isKira,
  messageId,
  isWorking,
  parts,
  isEditing,
  showsActions,
  onFork,
}: {
  isKira: boolean;
  messageId: string;
  isWorking: boolean;
  parts: readonly ChatPart[];
  isEditing: boolean;
  /** Whether this message is where its turn's branch picker and actions go. */
  showsActions: boolean;
  onFork: (messageId: string) => Promise<void>;
}) {
  // A boundary is not something anybody said, so it does not go in the bubble:
  // it stands across the column, above the message it hands over to.
  const said = saidIn(parts);
  const messageText = textOf(said);
  const { copy, isCopied } = useClipboard({ announce: 'Message copied' });

  // A message being changed shows the box its words go back into, and nothing
  // else: what it offered to do with it — ask again, fork — is for a message
  // that is standing still.
  if (isEditing) {
    return (
      <MessagePrimitive.Root className="line">
        <Composer placeholder="Say it differently" isEditing />
      </MessagePrimitive.Root>
    );
  }

  return (
    <MessagePrimitive.Root className="line" data-sender={isKira ? 'assistant' : 'user'}>
      {boundariesIn(parts)}

      {said.length > 0 && (
        <ChatMessage sender={isKira ? 'assistant' : 'user'}>
          {/*
           * Kira's answer is flat: `ghost` is Astryx's name for "no background,
           * keep the text column", and the width replaces the default
           * `max(80%, 280px)` cap so prose, lists and code blocks get the pane.
           * A question keeps its bubble — it is a thing you said, sitting on the
           * right, not a document to read. Padding is the bubble's either way,
           * which is what keeps words off the pane's edge.
           */}
          <ChatMessageBubble
            variant={isKira ? 'ghost' : 'filled'}
            width={isKira ? '100%' : undefined}
          >
            <MessageBody parts={said} isKira={isKira} isWorking={isWorking} />
          </ChatMessageBubble>
        </ChatMessage>
      )}

      {showsActions && (
        <div className="line-actions">
          <BranchPickerPrimitive.Root hideWhenSingleBranch className="branches">
            <BranchPickerPrimitive.Previous asChild>
              <Button
                label="Previous reply"
                size="sm"
                variant="ghost"
                icon={<span>←</span>}
                isIconOnly
              />
            </BranchPickerPrimitive.Previous>
            <Text color="secondary">
              <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
            </Text>
            <BranchPickerPrimitive.Next asChild>
              <Button
                label="Next reply"
                size="sm"
                variant="ghost"
                icon={<span>→</span>}
                isIconOnly
              />
            </BranchPickerPrimitive.Next>
          </BranchPickerPrimitive.Root>

          <ActionBarPrimitive.Root hideWhenRunning className="action-bar">
            {isKira ? (
              <ActionBarPrimitive.Reload asChild>
                <Button
                  label="Ask again"
                  tooltip="Ask again"
                  size="sm"
                  variant="ghost"
                  icon={<Icon icon={RotateCcw} size="sm" />}
                  isIconOnly
                />
              </ActionBarPrimitive.Reload>
            ) : (
              <ActionBarPrimitive.Edit asChild>
                <Button
                  label="Edit"
                  tooltip="Edit"
                  size="sm"
                  variant="ghost"
                  icon={<Icon icon={Pencil} size="sm" />}
                  isIconOnly
                />
              </ActionBarPrimitive.Edit>
            )}

            <Button
              label="Fork"
              tooltip="Fork"
              size="sm"
              variant="ghost"
              icon={<Icon icon={GitFork} size="sm" />}
              isIconOnly
              onClick={() => void onFork(messageId)}
            />

            <Button
              label={isCopied ? 'Copied' : 'Copy'}
              tooltip={isCopied ? 'Copied' : 'Copy'}
              size="sm"
              variant="ghost"
              icon={<Icon icon={isCopied ? Check : Copy} size="sm" />}
              isIconOnly
              isDisabled={messageText === ''}
              onClick={() => void copy(messageText)}
            />
          </ActionBarPrimitive.Root>
        </div>
      )}
    </MessagePrimitive.Root>
  );
}

/**
 * What the runtime draws: the stored tree, plus the message being sent and the
 * reply arriving, each hung off the branch the reader is on so that both appear
 * where they belong. These two are the only messages here that pi has not
 * stored, which is why they are drawn with ids of their own.
 */
function withInFlight(
  transcript: ChatTranscript,
  pending: ChatLine | null,
  streaming: string | null,
  working: boolean,
): ChatTranscript {
  const messages = [...transcript.messages];
  let headId = transcript.headId;
  // A boundary nothing carries stands at the end of the chat. Saying something
  // moves it onto what was just said, which is where the stored transcript will
  // put it too — the boundary belongs above the words that carry on from it, not
  // below them.
  let trailing = transcript.trailing;

  if (pending) {
    messages.push({ ...pending, parts: [...trailing, ...pending.parts] });
    headId = pending.id;
    trailing = [];
  }

  if (streaming !== null) {
    const reply: ChatLine = {
      id: STREAMING_ID,
      parentId: headId,
      role: 'kira',
      parts: [...trailing, { type: 'text', text: streaming }],
    };
    messages.push(reply);
    headId = reply.id;
    // The reply is what carries on from the boundary now. A compaction made while
    // an answer was being written is the case: pi ends that answer first, and what
    // is left of it stands under the boundary rather than above it.
    trailing = [];
  } else if (working) {
    const latestUser = messages.reduce(
      (lastUser, message, index) => (message.role === 'you' ? index : lastUser),
      -1,
    );
    const hasCurrentWork = messages
      .slice(latestUser + 1)
      .some((message) => message.parts.some((part) => part.type === 'work'));

    if (!hasCurrentWork) {
      const reply: ChatLine = {
        id: STREAMING_ID,
        parentId: headId,
        role: 'kira',
        parts: [...trailing, { type: 'work', reasoning: null, durationMs: null, calls: [] }],
      };
      messages.push(reply);
      headId = reply.id;
      trailing = [];
    }
  }

  return { messages, trailing, headId };
}

/** A stored message in the shape the runtime reads. */
function messageLike(message: ChatLine): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role === 'you' ? 'user' : 'assistant',
    content: saidIn(message.parts)
      .filter((part) => part.type !== 'glossary')
      .map((part, index) => partLike(part, message.id, index)),
    // Only a reply carries a status, and only the one still arriving is running.
    ...(message.role === 'kira'
      ? {
          status:
            message.id === STREAMING_ID
              ? { type: 'running' }
              : { type: 'complete', reason: 'stop' },
        }
      : {}),
    // The message just sent is not stored yet: saying so keeps the runtime from
    // treating the id it was given here as one of pi's.
    ...(message.id === PENDING_ID ? { metadata: { isOptimistic: true } } : {}),
  };
}

/** One part of a message, in the shape the runtime reads. */
type ContentPart = Exclude<ThreadMessageLike['content'], string>[number];

/**
 * One part in the shape the runtime reads. The window draws what a reply said
 * and ran from the transcript's own parts, so all the runtime needs here is to
 * know that Kira ran something: a tool call carries no arguments of its own.
 *
 * A boundary is not drawn from the runtime's copy at all — it stands outside the
 * bubble, so it is left out here rather than given a shape it would never use.
 */
function partLike(part: ChatPart, messageId: string, index: number): ContentPart {
  if (part.type === 'text') {
    return { type: 'text', text: part.text };
  }

  return {
    type: 'tool-call',
    // pi mints no id for a call the window never asks about, and the runtime
    // keys tool calls by this, so it has to be one per part.
    toolCallId: `${messageId}-${index}`,
    toolName: 'tools',
  };
}

/**
 * What a message says: its words, and the tools Kira ran between them.
 *
 * The parts drawn are the transcript's, not the runtime's copy of them. The
 * runtime's copy is there so it knows a reply carries more than words; the
 * transcript's says what those words were and what each tool came to, which is
 * what a reader is looking at.
 */
function MessageBody({
  parts,
  isKira,
  isWorking,
}: {
  parts: readonly SaidPart[];
  isKira: boolean;
  isWorking: boolean;
}) {
  return (
    <>
      {parts.map((part, index) =>
        part.type === 'text' ? (
          // A question is words, and reads as words; only Kira's answer is
          // markdown, because that is what the model writes.
          <Fragment key={index}>{isKira ? <Markdown>{part.text}</Markdown> : part.text}</Fragment>
        ) : part.type === 'glossary' ? (
          <GlossaryNote key={index} change={part.change} />
        ) : (
          <Work key={index} part={part} isWorking={isWorking} />
        ),
      )}
    </>
  );
}

/** A quiet, reversible server note rather than a confirmation or approval card. */
function GlossaryNote({ change }: { change: GlossaryChangeNote }) {
  const [state, setState] = useState<'ready' | 'working' | 'undone' | 'stale' | 'error'>('ready');

  const undo = async (): Promise<void> => {
    setState('working');
    const result = await window.foundry.undoGlossary(
      change.workspaceId,
      change.entryId,
      change.version,
      change.chatId,
    );
    setState(result.ok ? 'undone' : result.error.includes('no longer current') ? 'stale' : 'error');
  };

  return (
    <Text type="supporting" color="secondary">
      Glossary updated: <strong>{change.term}</strong>{' '}
      {state === 'ready' && (
        <Button label="Undo" size="sm" variant="ghost" onClick={() => void undo()} />
      )}
      {state === 'working' && 'Undoing…'}
      {state === 'undone' && 'Undone.'}
      {state === 'stale' && 'This change is no longer current.'}
      {state === 'error' && 'Undo could not be applied.'}
    </Text>
  );
}

/** The words of a message: its text parts joined, and nothing else it carries. */
function textOf(parts: readonly { type: string; text?: string | undefined }[]): string {
  return parts.flatMap((part) => (part.type === 'text' ? [part.text ?? ''] : [])).join('');
}
