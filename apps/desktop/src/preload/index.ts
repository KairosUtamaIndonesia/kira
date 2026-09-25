import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  AUTH_CHANNELS,
  BROWSER_CHANNELS,
  CHAT_CHANNELS,
  FILE_CHANNELS,
  MEMORY_CHANNELS,
  MCP_CHANNELS,
  MODELS_CHANNELS,
  RUN_CHANNELS,
  TRACKER_CHANNELS,
  UPDATE_CHANNELS,
  SHELL_CHANNELS,
  WORKER_CHANNELS,
  WORKSPACE_CHANNELS,
  USAGE_CHANNELS,
  type AuthState,
  type ChatEvent,
  type ChatState,
  type ChatMode,
  type FolderListing,
  type KiraBridge,
  type GlossaryEntry,
  type MemorySettings,
  type McpServer,
  type McpServerDraft,
  type McpToolSelection,
  type ModelOption,
  type ProjectSummary,
  type Ticket,
  type TicketQueue,
  type TicketRun,
  type TicketSaid,
  type WorkspaceSummary,
  type WorkerStanding,
  type QueuedLine,
  type Usage,
  type DesktopUpdateSnapshot,
  type ShellSettingsSnapshot,
  type ShellTestResult,
  type Result,
} from './bridge';

/**
 * Ask the main process for something, and hand back an envelope either way.
 *
 * A channel the process beside this window does not know — a window from a
 * newer build than the main process it is talking to — is a refusal the window
 * can show, rather than a rejected promise that goes quietly nowhere.
 */
function ask<T>(channel: string, ...args: unknown[]): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, ...args).then(
    (value: Result<T>) => value,
    (reason: unknown) => ({
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
    }),
  );
}

const bridge: KiraBridge = {
  platform: process.platform,

  registerBrowserGuest: (input) => ask<null>(BROWSER_CHANNELS.register, input),

  activateBrowser: (chatId, browserId) => ask<null>(BROWSER_CHANNELS.activate, chatId, browserId),

  deactivateBrowser: (chatId) => ask<null>(BROWSER_CHANNELS.deactivate, chatId),

  loadChat: () => ask<ChatState>(CHAT_CHANNELS.load),
  setChatMode: (mode: ChatMode) => ask<null>(CHAT_CHANNELS.setMode, mode),

  approveProposal: (proposalId) => ask<null>(CHAT_CHANNELS.proposalApprove, proposalId),

  rejectProposal: (proposalId) => ask<null>(CHAT_CHANNELS.proposalReject, proposalId),

  sendBackOutcome: (proposalId) => ask<null>(CHAT_CHANNELS.outcomeSendBack, proposalId),

  retryBreakdownReady: () => ask<null>(CHAT_CHANNELS.shapeRetryReady),

  answerQuestionnaire: (threadId, requestId, result) =>
    ask<null>(CHAT_CHANNELS.questionnaireAnswer, threadId, requestId, result),
  cancelQuestionnaire: (threadId, requestId) =>
    ask<null>(CHAT_CHANNELS.questionnaireCancel, threadId, requestId),
  sendMessage: (text) => ask<null>(CHAT_CHANNELS.send, text),

  queueMessage: (text, lane) => ask<null>(CHAT_CHANNELS.queue, text, lane),

  takeQueuedBack: () => ask<QueuedLine[]>(CHAT_CHANNELS.unqueue),

  stopChat: () => ask<QueuedLine[]>(CHAT_CHANNELS.stop),
  compactChat: () => ask<null>(CHAT_CHANNELS.compact),

  startChat: (workspaceId) => ask<null>(CHAT_CHANNELS.start, workspaceId),

  openChat: (id) => ask<null>(CHAT_CHANNELS.open, id),

  archiveChat: (id) => ask<null>(CHAT_CHANNELS.archive, id),

  restoreChat: (id) => ask<null>(CHAT_CHANNELS.restore, id),

  deleteChat: (id) => ask<null>(CHAT_CHANNELS.delete, id),

  switchBranch: (messageId) => ask<null>(CHAT_CHANNELS.branch, messageId),

  editMessage: (messageId) => ask<null>(CHAT_CHANNELS.edit, messageId),

  forkChat: (messageId) => ask<null>(CHAT_CHANNELS.fork, messageId),

  addWorkspace: () => ask<WorkspaceSummary | null>(WORKSPACE_CHANNELS.add),

  removeWorkspace: (id) => ask<null>(WORKSPACE_CHANNELS.remove, id),

  joinableProjects: () => ask<ProjectSummary[]>(WORKSPACE_CHANNELS.projects),

  joinWorkspace: (workspaceId, request) =>
    ask<WorkspaceSummary>(WORKSPACE_CHANNELS.join, workspaceId, request),

  loadQueue: (workspaceId) => ask<TicketQueue>(TRACKER_CHANNELS.queue, workspaceId),

  openQuestion: (workspaceId, ticketId) =>
    ask<Ticket>(TRACKER_CHANNELS.questionChat, workspaceId, ticketId),

  writeTicket: (workspaceId, draft) => ask<Ticket>(TRACKER_CHANNELS.write, workspaceId, draft),

  changeTicket: (ticketId, change) => ask<Ticket>(TRACKER_CHANNELS.change, ticketId, change),

  gateTicket: (ticketId, gatedBy) => ask<Ticket>(TRACKER_CHANNELS.gate, ticketId, gatedBy),

  ungateTicket: (ticketId, gatedBy) => ask<Ticket>(TRACKER_CHANNELS.ungate, ticketId, gatedBy),

  undoGlossary: (workspaceId, entryId, version, chatId) =>
    ask<GlossaryEntry>(TRACKER_CHANNELS.undoGlossary, workspaceId, entryId, version, chatId),

  worker: () => ask<WorkerStanding>(WORKER_CHANNELS.standing),

  startRun: (workspaceId, ticketId) => ask<TicketRun>(RUN_CHANNELS.start, workspaceId, ticketId),

  resolveRun: (workspaceId, ticketId, reason) =>
    ask<TicketRun>(RUN_CHANNELS.resolve, workspaceId, ticketId, reason),

  readTranscript: (ticketId, runId) => ask<TicketSaid[]>(RUN_CHANNELS.transcript, ticketId, runId),

  takeOverClaim: (ticketId) => ask<Ticket>(RUN_CHANNELS.takeover, ticketId),

  releaseClaim: (ticketId) => ask<null>(RUN_CHANNELS.release, ticketId),

  judgeRun: (ticketId, runId, verdict, workspaceId) =>
    ask<TicketRun>(RUN_CHANNELS.judge, ticketId, runId, verdict, workspaceId),

  listWorkspaceFolder: (chatId, path) =>
    ask<FolderListing | null>(FILE_CHANNELS.list, chatId, path),

  readWorkspaceFile: (chatId, path) => ask<string>(FILE_CHANNELS.read, chatId, path),

  watchWorkspace: (chatId, folders) => ask<null>(FILE_CHANNELS.watch, chatId, folders),

  unwatchWorkspace: () => ask<null>(FILE_CHANNELS.unwatch),

  onWorkspaceChanged: (listener) => {
    const handler = (): void => {
      listener();
    };

    ipcRenderer.on(FILE_CHANNELS.changed, handler);

    return () => {
      ipcRenderer.off(FILE_CHANNELS.changed, handler);
    };
  },

  loadAuth: () => ask<AuthState>(AUTH_CHANNELS.load),

  signIn: () => ask<null>(AUTH_CHANNELS.signIn),

  signOut: () => ask<AuthState>(AUTH_CHANNELS.signOut),

  onChatEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: ChatEvent): void => {
      listener(payload);
    };

    ipcRenderer.on(CHAT_CHANNELS.event, handler);

    return () => {
      ipcRenderer.off(CHAT_CHANNELS.event, handler);
    };
  },

  loadUsage: () => ask<Usage | null>(USAGE_CHANNELS.load),

  loadModels: () => ask<ModelOption[]>(MODELS_CHANNELS.load),

  chooseModel: (modelId: string) => ask<null>(MODELS_CHANNELS.choose, modelId),

  loadMemory: () => ask<MemorySettings | null>(MEMORY_CHANNELS.load),

  saveMemory: (decided) => ask<MemorySettings>(MEMORY_CHANNELS.save, decided),

  loadMcpServers: () => ask<McpServer[]>(MCP_CHANNELS.load),

  addMcpServer: (draft: McpServerDraft) => ask<McpServer>(MCP_CHANNELS.add, draft),

  updateMcpServer: (id: string, draft: McpServerDraft) =>
    ask<McpServer>(MCP_CHANNELS.update, id, draft),

  removeMcpServer: (id: string) => ask<null>(MCP_CHANNELS.remove, id),

  reconnectMcpServer: (id: string) => ask<null>(MCP_CHANNELS.reconnect, id),

  setMcpServerEnabled: (id: string, enabled: boolean) =>
    ask<null>(MCP_CHANNELS.setEnabled, id, enabled),

  setMcpServerToolSelection: (id: string, selection: McpToolSelection) =>
    ask<null>(MCP_CHANNELS.setToolSelection, id, selection),

  signInMcpServer: (id: string) => ask<null>(MCP_CHANNELS.signIn, id),

  signOutMcpServer: (id: string) => ask<null>(MCP_CHANNELS.signOut, id),

  onMcpEvent: (listener: (servers: McpServer[]) => void) => {
    const handler = (_event: IpcRendererEvent, payload: McpServer[]): void => {
      listener(payload);
    };

    ipcRenderer.on(MCP_CHANNELS.event, handler);

    return () => {
      ipcRenderer.off(MCP_CHANNELS.event, handler);
    };
  },

  onUsageEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: Usage | null): void => {
      listener(payload);
    };

    ipcRenderer.on(USAGE_CHANNELS.event, handler);

    return () => {
      ipcRenderer.off(USAGE_CHANNELS.event, handler);
    };
  },

  onAuthEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: AuthState): void => {
      listener(payload);
    };

    ipcRenderer.on(AUTH_CHANNELS.event, handler);

    return () => {
      ipcRenderer.off(AUTH_CHANNELS.event, handler);
    };
  },

  loadDesktopUpdate: () => ask<DesktopUpdateSnapshot>(UPDATE_CHANNELS.load),

  checkDesktopUpdate: () => ask<DesktopUpdateSnapshot>(UPDATE_CHANNELS.check),

  installDesktopUpdate: () => ask<{ installed: boolean; message: string }>(UPDATE_CHANNELS.install),

  onDesktopUpdateEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: DesktopUpdateSnapshot): void => {
      listener(payload);
    };

    ipcRenderer.on(UPDATE_CHANNELS.event, handler);

    return () => {
      ipcRenderer.off(UPDATE_CHANNELS.event, handler);
    };
  },

  loadShellSettings: () => ask<ShellSettingsSnapshot>(SHELL_CHANNELS.load),

  browseShellPath: () => ask<string | null>(SHELL_CHANNELS.browse),

  testShellPath: (path) => ask<ShellTestResult>(SHELL_CHANNELS.test, path),

  saveShellPath: (path) => ask<null>(SHELL_CHANNELS.save, path),
};

contextBridge.exposeInMainWorld('kira', bridge);
