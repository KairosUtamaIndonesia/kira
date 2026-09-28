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
  DELIVERY_CHANNELS,
  EXECUTION_CHANNELS,
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
  type WorkspaceAsset,
  type WorkerStanding,
  type QueuedLine,
  type Usage,
  type DesktopUpdateSnapshot,
  type ExecutionWorkspace,
  type ExecutionReview,
  type ReviewComment,
  type ReviewFeedback,
  type DeliveryAudit,
  type ExecutionCommandResult,
  type ExecutionProcessSnapshot,
  type ExecutionProcessEvent,
  type ExecutionTerminalSnapshot,
  type ExecutionTerminalEvent,
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

  listExecutionWorkspaces: (ticketId) =>
    ask<ExecutionWorkspace[]>(TRACKER_CHANNELS.executionWorkspaces, ticketId),

  createExecutionWorkspace: (ticketId, draft) =>
    ask<ExecutionWorkspace>(TRACKER_CHANNELS.createExecutionWorkspace, ticketId, draft),

  removeExecutionWorkspace: (ticketId, workspaceId) =>
    ask<null>(TRACKER_CHANNELS.removeExecutionWorkspace, ticketId, workspaceId),

  readExecutionReview: (ticketId, workspaceId) =>
    ask<ExecutionReview>(TRACKER_CHANNELS.readExecutionReview, ticketId, workspaceId),

  addReviewComment: (ticketId, workspaceId, comment) =>
    ask<ReviewComment>(TRACKER_CHANNELS.addReviewComment, ticketId, workspaceId, comment),

  updateReviewComment: (ticketId, workspaceId, commentId, status) =>
    ask<ReviewComment>(
      TRACKER_CHANNELS.updateReviewComment,
      ticketId,
      workspaceId,
      commentId,
      status,
    ),

  sendReviewFeedback: (ticketId, workspaceId, feedback) =>
    ask<ReviewFeedback>(TRACKER_CHANNELS.sendReviewFeedback, ticketId, workspaceId, feedback),

  deliverExecutionWorkspace: (ticketId, workspaceId, path) =>
    ask<DeliveryAudit>(DELIVERY_CHANNELS.deliver, ticketId, workspaceId, path),

  runExecutionCommand: (ticketId, workspaceId, command) =>
    ask<ExecutionCommandResult>(EXECUTION_CHANNELS.command, ticketId, workspaceId, command),

  startExecutionDevServer: (ticketId, workspaceId, command) =>
    ask<ExecutionProcessSnapshot>(
      EXECUTION_CHANNELS.devServerStart,
      ticketId,
      workspaceId,
      command,
    ),

  readExecutionDevServer: (ticketId, workspaceId) =>
    ask<ExecutionProcessSnapshot>(EXECUTION_CHANNELS.devServerRead, ticketId, workspaceId),

  stopExecutionDevServer: (ticketId, workspaceId) =>
    ask<ExecutionProcessSnapshot>(EXECUTION_CHANNELS.devServerStop, ticketId, workspaceId),

  onExecutionProcess: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: ExecutionProcessEvent): void => {
      listener(payload);
    };
    ipcRenderer.on(EXECUTION_CHANNELS.process, handler);
    return () => ipcRenderer.off(EXECUTION_CHANNELS.process, handler);
  },

  startExecutionTerminal: (ticketId, workspaceId) =>
    ask<ExecutionTerminalSnapshot>(EXECUTION_CHANNELS.terminalStart, ticketId, workspaceId),

  readExecutionTerminal: (ticketId, workspaceId) =>
    ask<ExecutionTerminalSnapshot>(EXECUTION_CHANNELS.terminalRead, ticketId, workspaceId),

  writeExecutionTerminal: (ticketId, workspaceId, data) =>
    ask<null>(EXECUTION_CHANNELS.terminalWrite, ticketId, workspaceId, data),

  resizeExecutionTerminal: (ticketId, workspaceId, cols, rows) =>
    ask<null>(EXECUTION_CHANNELS.terminalResize, ticketId, workspaceId, cols, rows),

  stopExecutionTerminal: (ticketId, workspaceId) =>
    ask<ExecutionTerminalSnapshot>(EXECUTION_CHANNELS.terminalStop, ticketId, workspaceId),

  onExecutionTerminal: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: ExecutionTerminalEvent): void => {
      listener(payload);
    };
    ipcRenderer.on(EXECUTION_CHANNELS.terminalEvent, handler);
    return () => ipcRenderer.off(EXECUTION_CHANNELS.terminalEvent, handler);
  },

  worker: () => ask<WorkerStanding>(WORKER_CHANNELS.standing),

  startRun: (workspaceId, ticketId, executionWorkspaceId, followUp) =>
    ask<TicketRun>(RUN_CHANNELS.start, workspaceId, ticketId, executionWorkspaceId, followUp),

  resolveRun: (workspaceId, ticketId, reason) =>
    ask<TicketRun>(RUN_CHANNELS.resolve, workspaceId, ticketId, reason),

  readTranscript: (ticketId, runId) => ask<TicketSaid[]>(RUN_CHANNELS.transcript, ticketId, runId),
  readExecutionDiff: (ticketId, executionWorkspaceId) =>
    ask<string>(RUN_CHANNELS.diff, ticketId, executionWorkspaceId),

  takeOverClaim: (ticketId) => ask<Ticket>(RUN_CHANNELS.takeover, ticketId),

  releaseClaim: (ticketId) => ask<null>(RUN_CHANNELS.release, ticketId),

  judgeRun: (ticketId, runId, verdict, workspaceId) =>
    ask<TicketRun>(RUN_CHANNELS.judge, ticketId, runId, verdict, workspaceId),

  listWorkspaceFolder: (chatId, path) =>
    ask<FolderListing | null>(FILE_CHANNELS.list, chatId, path),

  readWorkspaceFile: (chatId, path) => ask<string>(FILE_CHANNELS.read, chatId, path),

  writeWorkspaceFile: (chatId, path, expected, content) =>
    ask<null>(FILE_CHANNELS.write, chatId, path, expected, content),

  readWorkspaceAsset: (chatId, path) => ask<WorkspaceAsset>(FILE_CHANNELS.asset, chatId, path),

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
