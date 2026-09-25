import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  safeStorage,
  shell,
  type WebContents,
  type OpenDialogOptions,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { AuthState, ChatEvent } from '../preload/bridge.ts';
import { foundryFor } from './auth/foundry.ts';
import { keyStore, type SecretKeeper } from './auth/keys.ts';
import { handoffToken, signIn, type SignIn } from './auth/signIn.ts';
import { ThreadStore } from './db/threads.ts';
import { AUTH_CHANNELS, authHandlers } from './ipc/auth.ts';
import { FILE_CHANNELS, fileHandlers } from './ipc/files.ts';
import { MCP_CHANNELS, mcpHandlers } from './ipc/mcp.ts';
import { MEMORY_CHANNELS, memoryHandlers } from './ipc/memory.ts';
import { MODELS_CHANNELS, modelHandlers } from './ipc/models.ts';
import { RUN_CHANNELS, runHandlers } from './ipc/run.ts';
import { USAGE_CHANNELS, usageHandlers } from './ipc/usage.ts';
import { CHAT_CHANNELS, chatHandlers } from './ipc/chat.ts';
import { TRACKER_CHANNELS, trackerHandlers } from './ipc/tracker.ts';
import { WORKER_CHANNELS, workerHandlers } from './ipc/worker.ts';
import { WORKSPACE_CHANNELS, workspaceHandlers } from './ipc/workspaces.ts';
import { workspaceSummaryOf } from './pi/conversations.ts';
import { foundryModels, type Models } from './pi/models.ts';
import { memoryFor, type MemoryKeeper } from './memory.ts';
import { trackerFor, type Tracker } from './tracker.ts';
import { usageFor, type UsageKeeper } from './usage.ts';
import { runsFor, type Runs } from './runs.ts';
import { startRunChat } from './pi/runChat.ts';
import { runWorktrees } from './workspace/worktrees.ts';
import { workerFor, type Worker } from './worker.ts';
import { type OpenChats, openChats } from './pi/openChats.ts';
import { listFolder } from './workspace/listing.ts';
import { readWorkspaceFile } from './workspace/reading.ts';
import { watchFolders } from './workspace/watching.ts';
import { mcpManager, type McpManager } from './mcp/servers.ts';
import { mcpSecretStore } from './mcp/secrets.ts';
import { mcpOAuth } from './mcp/authorization.ts';
import { browserForWindow } from './browser/controller.ts';
import { BROWSER_CHANNELS, browserHandlers } from './ipc/browser.ts';
import { Questionnaires } from './questionnaires.ts';
import { desktopUpdates } from './updates-electron.ts';
import { UPDATE_CHANNELS, updatesHandlers } from './ipc/updates.ts';
import { SHELL_CHANNELS, shellHandlers } from './ipc/shell.ts';
import { kiraShellSettings, type KiraShell } from './pi/shell.ts';

/**
 * The custom protocol sign-in is returned to by.
 *
 * The app's own id the other way round, which is how a custom protocol is named
 * so that no other application can claim it. The server has to trust the same
 * string as an origin, so `FOUNDRY_DESKTOP_SCHEME` in `apps/server/.env` and
 * this constant are one decision written twice.
 */
const SCHEME = 'ai.foundry.kairos';

/** Where the Foundry server is, overridable so a build can be pointed elsewhere. */
const SERVER = process.env['FOUNDRY_API_URL'] ?? 'http://localhost:4100';

/** The stored chats, the ones open, the window showing them, and who is signed in. */
let store: ThreadStore;
let chats: OpenChats;
let models: Models;
let usage: UsageKeeper;
let memory: MemoryKeeper;
let mcp: McpManager;
let questionnaires: Questionnaires;
let tracker: Tracker;
let worker: Worker;
let runs: Runs;
let auth: SignIn | undefined;
let mainWindow: BrowserWindow | undefined;
let kiraShell: KiraShell | undefined;

function shellSettings(): KiraShell {
  kiraShell ??= kiraShellSettings((path) => chats?.setShellPath(path) ?? Promise.resolve());
  return kiraShell;
}

/**
 * The channels are registered once and read the open chats, so a window opened
 * after another has closed — macOS keeps the app alive without one — finds the
 * chat that is actually on screen.
 */
function registerChatChannels(): void {
  const handlers = chatHandlers({
    state: () => chats.state(),
    send: (text) => chats.send(text),
    setMode: (mode) => chats.setMode(mode),
    approveProposal: (proposalId) => chats.approveProposal(proposalId),
    rejectProposal: (proposalId) => chats.rejectProposal(proposalId),
    sendBackOutcome: (proposalId) => chats.sendBackOutcome(proposalId),
    retryBreakdownReady: () => chats.retryBreakdownReady(),
    answerQuestionnaire: (threadId, requestId, result) =>
      questionnaires.submit(threadId, requestId, result),
    cancelQuestionnaire: (threadId, requestId) => questionnaires.cancel(threadId, requestId),
    queue: (text, lane) => chats.queue(text, lane),
    takeQueuedBack: () => chats.takeQueuedBack(),
    stop: () => chats.stop(),
    compact: () => chats.compact(),
    start: (projectId) => chats.start(projectId),
    open: (threadId) => chats.open(threadId),
    branch: (messageId) => chats.branch(messageId),
    edit: (messageId) => chats.edit(messageId),
    fork: (messageId) => chats.fork(messageId),
    archiveChat: (id) => chats.archiveChat(id),
    restoreChat: (id) => chats.restoreChat(id),
    deleteChat: (id) => chats.deleteChat(id),
  });

  ipcMain.handle(CHAT_CHANNELS.load, () => handlers.load());
  ipcMain.handle(CHAT_CHANNELS.setMode, (_event, mode: unknown) => handlers.setMode(mode));
  // A turn that has just finished is what moves the month's number, so the
  // reading is asked for again the moment one ends — here and on a stop, the two
  // ways a turn ends as far as this process can see. A turn carried on by words
  // waiting for later leaves the number a turn behind until the next one ends,
  // which is a number that lags rather than one that lies.
  ipcMain.handle(CHAT_CHANNELS.proposalApprove, (_event, proposalId: unknown) =>
    handlers.approveProposal(proposalId),
  );
  ipcMain.handle(CHAT_CHANNELS.proposalReject, (_event, proposalId: unknown) =>
    handlers.rejectProposal(proposalId),
  );
  ipcMain.handle(CHAT_CHANNELS.outcomeSendBack, (_event, proposalId: unknown) =>
    handlers.sendBackOutcome(proposalId),
  );
  ipcMain.handle(CHAT_CHANNELS.shapeRetryReady, () => handlers.retryBreakdownReady());
  ipcMain.handle(
    CHAT_CHANNELS.questionnaireAnswer,
    (event, threadId: unknown, requestId: unknown, result: unknown) => {
      if (event.sender !== mainWindow?.webContents) {
        return { ok: false, error: 'This window cannot answer that question.' };
      }
      return handlers.answerQuestionnaire(threadId, requestId, result);
    },
  );
  ipcMain.handle(
    CHAT_CHANNELS.questionnaireCancel,
    (event, threadId: unknown, requestId: unknown) => {
      if (event.sender !== mainWindow?.webContents) {
        return { ok: false, error: 'This window cannot cancel that question.' };
      }
      return handlers.cancelQuestionnaire(threadId, requestId);
    },
  );
  ipcMain.handle(CHAT_CHANNELS.send, async (_event, text: unknown) => {
    const answer = await handlers.send(text);
    // Started once the turn is over, and not waited on: the window hears the new
    // reading by event, so a slow month is no reason to hold up the reply.
    void usage.refresh();
    return answer;
  });
  ipcMain.handle(CHAT_CHANNELS.queue, (_event, text: unknown, lane: unknown) =>
    handlers.queue(text, lane),
  );
  ipcMain.handle(CHAT_CHANNELS.unqueue, () => handlers.unqueue());
  ipcMain.handle(CHAT_CHANNELS.stop, async () => {
    const answer = await handlers.stop();
    void usage.refresh();
    return answer;
  });
  // Compacting can spend a model call — the reflector reads what the chat has
  // recorded once there is something to read — so the month's number is asked for
  // again, as it is after a turn ends.
  ipcMain.handle(CHAT_CHANNELS.compact, async () => {
    const answer = await handlers.compact();
    void usage.refresh();
    return answer;
  });
  ipcMain.handle(CHAT_CHANNELS.start, (_event, projectId: unknown) => handlers.start(projectId));
  ipcMain.handle(CHAT_CHANNELS.open, (_event, threadId: unknown) => handlers.open(threadId));
  ipcMain.handle(CHAT_CHANNELS.branch, (_event, messageId: unknown) => handlers.branch(messageId));
  ipcMain.handle(CHAT_CHANNELS.edit, (_event, messageId: unknown) => handlers.edit(messageId));
  ipcMain.handle(CHAT_CHANNELS.fork, (_event, messageId: unknown) => handlers.fork(messageId));
  ipcMain.handle(CHAT_CHANNELS.archive, (_event, id: unknown) => handlers.archive(id));
  ipcMain.handle(CHAT_CHANNELS.restore, (_event, id: unknown) => handlers.restore(id));
  ipcMain.handle(CHAT_CHANNELS.delete, (_event, id: unknown) => handlers.delete(id));
}

/** What the window hears about a turn: words as they are written, then the record. */
function pushEvent(event: ChatEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(CHAT_CHANNELS.event, event);
  }
}

/**
 * Ask for a folder, over the window when there is one.
 *
 * Closing the picker answers null: choosing nothing is a choice, and the window
 * shows no new project rather than an error about one.
 */
async function chooseFolder(): Promise<string | null> {
  const options: OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory'],
  };
  const chosen =
    mainWindow === undefined || mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options);

  return chosen.canceled ? null : (chosen.filePaths[0] ?? null);
}

/**
 * The workspace channels, over the store, the server and the one thing only this
 * side can do: ask for a folder.
 *
 * A workspace that works no project is offered the projects the server holds, or
 * the making of a new one, and the answer is remembered with the folder. The key
 * that reaches the server stays in this process, which is why the window asks
 * through here rather than speaking HTTP.
 */
function registerWorkspaceChannels(): void {
  const handlers = workspaceHandlers({
    chooseFolder,
    remember: (folder) => workspaceSummaryOf(store.rememberWorkspace(folder)),
    forget: (id) => chats.removeWorkspace(id),
    projects: () => tracker.projects(),
    join: (workspaceId, request) => tracker.join(workspaceId, request),
  });

  ipcMain.handle(WORKSPACE_CHANNELS.add, () => handlers.add());
  ipcMain.handle(WORKSPACE_CHANNELS.remove, (_event, id: unknown) => handlers.remove(id));
  ipcMain.handle(WORKSPACE_CHANNELS.projects, () => handlers.projects());
  ipcMain.handle(WORKSPACE_CHANNELS.join, (_event, workspaceId: unknown, request: unknown) =>
    handlers.join(workspaceId, request),
  );
}

/**
 * The channel the window reads this desktop's own offering through.
 *
 * Read from the keeper rather than asked of the server: what the window needs is
 * whether the last heartbeat landed, and asking again while drawing a surface would
 * make a slow server into a slow window.
 */
function registerWorkerChannel(): void {
  const handlers = workerHandlers({ standing: () => worker.standing() });

  ipcMain.handle(WORKER_CHANNELS.standing, () => handlers.standing());
}

/**
 * The tracker channels, over the store and the server.
 *
 * Which project a workspace works is read from the desktop's own database and
 * never from the window, so a folder that works none is answered as itself rather
 * than being handed an empty queue. Everything else is one call to the server, in
 * the server's own words when it refuses.
 */
/**
 * The channel pressing Run goes through.
 *
 * One act, and no reading of it: what a run is doing is on the ticket, which the surface
 * already reads, and what a run is doing *here* is the chat that is doing it.
 */
function registerRunChannel(): void {
  const handlers = runHandlers({
    start: (workspaceId, ticketId) => runs.start(workspaceId, ticketId),
    resolve: (workspaceId, ticketId, reason) => runs.resolve(workspaceId, ticketId, reason),
    transcript: (ticketId, runId) => runs.saidIn(ticketId, runId),
    takeOver: (ticketId) => runs.takeOverClaim(ticketId),
    release: (ticketId) => runs.letClaimGo(ticketId),
    judge: (ticketId, runId, verdict, workspaceId) =>
      runs.judge(ticketId, runId, verdict, workspaceId),
  });

  ipcMain.handle(RUN_CHANNELS.start, (_event, workspaceId: unknown, ticketId: unknown) =>
    handlers.start(workspaceId, ticketId),
  );
  ipcMain.handle(
    RUN_CHANNELS.resolve,
    (_event, workspaceId: unknown, ticketId: unknown, reason: unknown) =>
      handlers.resolve(workspaceId, ticketId, reason),
  );
  ipcMain.handle(RUN_CHANNELS.transcript, (_event, ticketId: unknown, runId: unknown) =>
    handlers.transcript(ticketId, runId),
  );
  ipcMain.handle(RUN_CHANNELS.takeover, (_event, ticketId: unknown) => handlers.takeOver(ticketId));
  ipcMain.handle(RUN_CHANNELS.release, (_event, ticketId: unknown) => handlers.release(ticketId));
  ipcMain.handle(
    RUN_CHANNELS.judge,
    (_event, ticketId: unknown, runId: unknown, verdict: unknown, workspaceId: unknown) =>
      handlers.judge(ticketId, runId, verdict, workspaceId),
  );
}

function registerTrackerChannels(): void {
  const handlers = trackerHandlers({
    queue: (workspaceId) => tracker.queue(workspaceId),
    openQuestion: async (workspaceId, ticketId) => {
      await chats.startQuestion(workspaceId, ticketId);
      return await tracker.readTicket(ticketId);
    },
    write: (workspaceId, draft) => tracker.write(workspaceId, draft),
    change: (ticketId, change) => tracker.change(ticketId, change),
    gate: (ticketId, gatedBy) => tracker.gate(ticketId, gatedBy),
    ungate: (ticketId, gatedBy) => tracker.ungate(ticketId, gatedBy),
    undoGlossary: (workspaceId, entryId, version, chatId) =>
      tracker.undoGlossary!(workspaceId, entryId, version, chatId),
  });

  ipcMain.handle(TRACKER_CHANNELS.queue, (_event, workspaceId: unknown) =>
    handlers.queue(workspaceId),
  );
  ipcMain.handle(TRACKER_CHANNELS.questionChat, (_event, workspaceId: unknown, ticketId: unknown) =>
    handlers.questionChat(workspaceId, ticketId),
  );
  ipcMain.handle(TRACKER_CHANNELS.write, (_event, workspaceId: unknown, draft: unknown) =>
    handlers.write(workspaceId, draft),
  );
  ipcMain.handle(TRACKER_CHANNELS.change, (_event, ticketId: unknown, change: unknown) =>
    handlers.change(ticketId, change),
  );
  ipcMain.handle(TRACKER_CHANNELS.gate, (_event, ticketId: unknown, gatedBy: unknown) =>
    handlers.gate(ticketId, gatedBy),
  );
  ipcMain.handle(TRACKER_CHANNELS.ungate, (_event, ticketId: unknown, gatedBy: unknown) =>
    handlers.ungate(ticketId, gatedBy),
  );
  ipcMain.handle(
    TRACKER_CHANNELS.undoGlossary,
    (_event, workspaceId: unknown, entryId: unknown, version: unknown, chatId: unknown) =>
      handlers.undoGlossary(workspaceId, entryId, version, chatId),
  );
}

/**
 * The file channels, over the chats this process already holds.
 *
 * The folder a chat works in is read from the chat's own record and never from
 * the window, which is the one way a workspace is resolved: a chat that has not
 * been spoken in yet is not stored at all, so there is nothing to resolve and
 * the workbench is told it has no workspace rather than being handed one.
 *
 * A watch belongs to the window that asked for it, and a window that goes away
 * stops watching: the pane cannot ask for that itself once it is gone, and a
 * watch nobody will ever stop is a folder watched for the rest of the run. The
 * same is true of a page that is replaced — a reload, or a view that navigates —
 * since the renderer that asked is unmounted without its cleanup ever running,
 * which in development is every time a file is saved.
 */
function registerFileChannels(): void {
  const handlers = fileHandlers({
    workspaceOf: (chatId) => store.findThread(chatId)?.cwd ?? null,
    list: listFolder,
    read: readWorkspaceFile,
    watch: watchFolders,
  });

  /** The windows already hooked, so a window's going away is hooked once. */
  const hooked = new Set<number>();

  ipcMain.handle(FILE_CHANNELS.list, (_event, chatId: unknown, path: unknown) =>
    handlers.list(chatId, path),
  );
  ipcMain.handle(FILE_CHANNELS.read, (_event, chatId: unknown, path: unknown) =>
    handlers.read(chatId, path),
  );
  ipcMain.handle(FILE_CHANNELS.watch, (event, chatId: unknown, paths: unknown) => {
    const window = event.sender;
    const key = window.id;
    const stop = (): void => {
      void handlers.unwatch(key);
    };

    if (!hooked.has(key)) {
      hooked.add(key);
      window.once('destroyed', () => {
        hooked.delete(key);
        stop();
      });
      // A page that is being replaced leaves its watch behind otherwise: the
      // effect that asked for it is never unmounted, so nothing ever stops it.
      // Only a navigation that replaces the page — a same-document one leaves
      // the pane mounted and still showing the tree, and stopping there would
      // leave the tree quietly behind with nothing to start it again.
      window.on('did-start-navigation', (details) => {
        if (!details.isSameDocument) stop();
      });
    }

    return handlers.watch(key, chatId, paths, () => {
      // A change that lands while the window is closing is nothing to say.
      if (!window.isDestroyed()) window.send(FILE_CHANNELS.changed);
    });
  });
  ipcMain.handle(FILE_CHANNELS.unwatch, (event) => handlers.unwatch(event.sender.id));
}

/** Browser guest commands are tied to the renderer that created each guest. */
function registerBrowserChannels(): void {
  const browser = browserForWindow();
  const handlers = browserHandlers({
    register: (sender, input) =>
      browser.register(
        sender as WebContents,
        input as { browserId: unknown; chatId: unknown; webContentsId: unknown },
      ),
    activate: (sender, chatId, browserId) =>
      browser.activate(sender as WebContents, chatId, browserId),
    deactivate: (sender, chatId) => browser.deactivate(sender as WebContents, chatId),
  });

  ipcMain.handle(BROWSER_CHANNELS.register, (event, input: unknown) =>
    handlers.register(event.sender, input),
  );
  ipcMain.handle(BROWSER_CHANNELS.activate, (event, chatId: unknown, browserId: unknown) =>
    handlers.activate(event.sender, chatId, browserId),
  );
  ipcMain.handle(BROWSER_CHANNELS.deactivate, (event, chatId: unknown) =>
    handlers.deactivate(event.sender, chatId),
  );
}

/**
 * The folder a new chat with no project works in: a workspace of its own.
 *
 * It is a convention rather than a sandbox — Kira has the same reach as a
 * terminal in here (ADR 0001) — and it is named for the glossary's word rather
 * than for a second word for the same thing.
 */
function newWorkspace(): string {
  // The folder on disk is still called `space`: every chat already made works in
  // one of these, and a name nobody sees is not worth migrating a hundred chats
  // for. It is the function that takes the glossary's word, which is the name
  // anyone reading this code meets.
  const folder = join(app.getPath('userData'), 'space', randomUUID());
  mkdirSync(folder, { recursive: true });

  return folder;
}

async function createWindow(): Promise<void> {
  // A window draws a chat, so one has to be on screen when there is one to
  // draw. This runs again when macOS re-activates the app after its window
  // closed, which is why it is a check rather than an unconditional open: that
  // window shows the chat it had.
  await showAChat();

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });

  mainWindow = window;
  browserForWindow().attachHost(window.webContents);

  // Closing the window ends every conversation: the sessions are disposed and
  // nothing is left holding a subscription that emits into a dead channel.
  window.on('closed', () => {
    mainWindow = undefined;
    chats.closeAll();
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

/**
 * Put a chat on screen, when there is something to answer in it.
 *
 * A machine that has not signed in has no models: the server offers them and
 * this device holds only the key to ask with
 * (docs/adr/0003-model-credentials.md). So a chat is not opened for it, and that
 * is not a failure — the window asks for sign-in, and a chat arrives once there
 * is something to run.
 */
async function showAChat(): Promise<void> {
  if (chats.showing() !== null) return;
  if ((await models.preferred()) === null) return;

  const recent = store.listThreads()[0]?.id;
  await (recent ? chats.open(recent) : chats.start(null));
}

/**
 * Who is signed in has changed, so what this machine can run has too.
 *
 * The catalog is read before the window is told, because a window that learns it
 * is signed in reads the chat straight away and there has to be one to read. A
 * server that cannot be reached leaves the window signed in with nothing to run,
 * which is the same state as a machine whose pool is empty: the chat says so
 * when it is asked for one.
 */
async function signedInAs(state: AuthState): Promise<void> {
  if (!state.signedIn) {
    // Offering work is something a signed-in machine does, so signing out stops it —
    // and says goodbye, because a desktop that stopped being heard from looks the same
    // as one that is thinking.
    await worker?.stop();
    // Asked for on the way out too: signing out leaves no key to ask with, and
    // that is what makes the reading nothing rather than the last person's.
    await usage.refresh();
    // The same, and for the same reason: what somebody decided about memory is
    // theirs, and a window left open on somebody else's switch is a lie.
    await memory.refresh();
    pushAuth(state);
    return;
  }

  await models.refresh();
  await usage.refresh();
  // And what they decided about memory, so a switch they set on another machine
  // is this one's answer too before any chat runs.
  await memory.refresh();
  await showAChat();
  // And this desktop offers itself, now that there is a key to offer it with.
  worker?.start();
  pushAuth(state);
}

/** What the window hears about who is signed in changing. */
function pushAuth(state: AuthState): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(AUTH_CHANNELS.event, state);
  }
}

/** The channels the window asks about models through. */
function registerModelChannels(): void {
  const handlers = modelHandlers({
    offered: () => models.catalog(),
    choose: (modelId) => chats.choose(modelId),
  });

  ipcMain.handle(MODELS_CHANNELS.load, () => handlers.load());

  // Told rather than asked: the choice changes a live session, so the window
  // reads the new state from the chat it already reloads rather than from this
  // call's answer.
  ipcMain.handle(MODELS_CHANNELS.choose, (_event, modelId: unknown) => handlers.choose(modelId));
}

/** The channels the window asks about memory through. */
function registerMemoryChannels(): void {
  const handlers = memoryHandlers({
    current: () => memory.current(),
    save: (decided) => memory.save(decided),
  });

  ipcMain.handle(MEMORY_CHANNELS.load, () => handlers.load());
  ipcMain.handle(MEMORY_CHANNELS.save, (_event, decided: unknown) => handlers.save(decided));
}

/** The channels the window asks about global MCP servers through. */
function registerMcpChannels(): void {
  const handlers = mcpHandlers({
    list: () => mcp.snapshots(),
    workspaceExists: (id) => store.findWorkspace(id) !== undefined,
    add: (draft) => mcp.add(draft),
    update: (id, draft) => mcp.update(id, draft),
    remove: (id) => mcp.remove(id),
    reconnect: (id) => mcp.reconnect(id),
    setEnabled: (id, enabled) => mcp.setEnabled(id, enabled),
    setToolSelection: (id, selection) => mcp.setToolSelection(id, selection),
    signIn: (id) => mcp.signIn(id),
    signOut: (id) => mcp.signOut(id),
  });

  ipcMain.handle(MCP_CHANNELS.load, () => handlers.load());
  ipcMain.handle(MCP_CHANNELS.add, (_event, draft: unknown) => handlers.add(draft));
  ipcMain.handle(MCP_CHANNELS.update, (_event, id: unknown, draft: unknown) =>
    handlers.update(id, draft),
  );
  ipcMain.handle(MCP_CHANNELS.remove, (_event, id: unknown) => handlers.remove(id));
  ipcMain.handle(MCP_CHANNELS.reconnect, (_event, id: unknown) => handlers.reconnect(id));
  ipcMain.handle(MCP_CHANNELS.setEnabled, (_event, id: unknown, enabled: unknown) =>
    handlers.setEnabled(id, enabled),
  );
  ipcMain.handle(MCP_CHANNELS.setToolSelection, (_event, id: unknown, selection: unknown) =>
    handlers.setToolSelection(id, selection),
  );
  ipcMain.handle(MCP_CHANNELS.signIn, (_event, id: unknown) => handlers.signIn(id));
  ipcMain.handle(MCP_CHANNELS.signOut, (_event, id: unknown) => handlers.signOut(id));

  mcp.subscribe(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(MCP_CHANNELS.event, mcp.snapshots());
    }
  });
}

/** The channel the window asks about this person's own usage through. */
function registerUsageChannels(): void {
  const handlers = usageHandlers({ current: () => usage.current() });

  ipcMain.handle(USAGE_CHANNELS.load, () => handlers.load());

  // Told rather than asked: the reading moves when a turn ends, which is a thing
  // this process knows and the window does not.
  usage.onChange((reading) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(USAGE_CHANNELS.event, reading);
    }
  });
}

/** The channels the window asks about signing in through. */
function registerAuthChannels(signingIn: SignIn): void {
  const handlers = authHandlers({
    current: () => signingIn.current(),
    begin: () => signingIn.begin(),
    signOut: () => signingIn.signOut(),
  });

  ipcMain.handle(AUTH_CHANNELS.load, () => handlers.load());
  ipcMain.handle(AUTH_CHANNELS.signIn, () => handlers.signIn());
  ipcMain.handle(AUTH_CHANNELS.signOut, () => handlers.signOut());
}

/** The update service stays in the main process; the window gets only its state. */
function registerUpdateChannels(): void {
  const handlers = updatesHandlers({
    snapshot: () => desktopUpdates.snapshot(),
    check: () => desktopUpdates.check(),
    install: () => desktopUpdates.install(),
  });

  ipcMain.handle(UPDATE_CHANNELS.load, () => handlers.load());
  ipcMain.handle(UPDATE_CHANNELS.check, () => handlers.check());
  ipcMain.handle(UPDATE_CHANNELS.install, () => handlers.install());
  desktopUpdates.subscribe((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(UPDATE_CHANNELS.event, snapshot);
    }
  });
}

/** Kira's local Bash executable preference and a picker for that executable. */
function registerShellChannels(): void {
  const handlers = shellHandlers({
    read: () => shellSettings().read(),
    choose: async () => {
      const current = shellSettings().read();
      const defaultPath = current.configuredPath ?? current.resolvedPath ?? undefined;
      const options: OpenDialogOptions = {
        ...(defaultPath === undefined ? {} : { defaultPath: dirname(defaultPath) }),
        properties: ['openFile'],
        ...(process.platform === 'win32'
          ? { filters: [{ name: 'Bash executable', extensions: ['exe'] }] }
          : {}),
      };
      const chosen =
        mainWindow === undefined || mainWindow.isDestroyed()
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(mainWindow, options);
      return chosen.canceled ? null : (chosen.filePaths[0] ?? null);
    },
    test: (path) => shellSettings().test(path),
    save: (path) => shellSettings().save(path),
  });

  ipcMain.handle(SHELL_CHANNELS.load, () => handlers.load());
  ipcMain.handle(SHELL_CHANNELS.browse, () => handlers.browse());
  ipcMain.handle(SHELL_CHANNELS.test, (_event, path: unknown) => handlers.test(path));
  ipcMain.handle(SHELL_CHANNELS.save, (_event, path: unknown) => handlers.save(path));
}

/**
 * Which keyring answered, which is recorded beside the ciphertext so a file
 * written under another one is not read as if it were this app's.
 *
 * Only Linux has a choice of keyring to report; elsewhere the platform is
 * answer enough.
 */
function storageBackend(): string {
  return process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform;
}

/**
 * Whether the operating system really has a keyring behind it.
 *
 * Not Electron's recommended asynchronous check: on Linux its provider chain
 * ends in a fallback that hands out a key anybody can reproduce while reporting
 * itself as usable, so a machine with no keyring would look encrypted. The
 * synchronous check answers yes only when a real secret is there, and
 * `basic_text` names the fallback outright (docs/adr/0006-key-storage.md).
 */
function encryptionIsReal(): boolean {
  return safeStorage.isEncryptionAvailable() && storageBackend() !== 'basic_text';
}

/** The operating system, as narrowly as the key store asks about it. */
function secretKeeper(): SecretKeeper {
  return {
    available: encryptionIsReal,
    backend: storageBackend,
    encrypt: (plaintext) => safeStorage.encryptStringAsync(plaintext),
    decrypt: async (ciphertext) => (await safeStorage.decryptStringAsync(ciphertext)).result,
  };
}

/** Bring the window forward, for a link that arrived while it was behind. */
function focusTheWindow(): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

/**
 * Take the deep link the operating system handed over, which is this app being
 * returned to by its own sign-in. Anything else that reaches here — another
 * application's link, or a path that is not the hand-off — is left alone.
 */
async function takeDeepLink(link: string | undefined): Promise<void> {
  if (link === undefined || auth === undefined) return;

  const token = handoffToken(link, SCHEME);
  // Not addressed to this app, or not the path sign-in comes back through.
  // A stray link is not a failure, so it is not logged as one either.
  if (token === null) return;

  try {
    await auth.finish(token);
  } catch (error: unknown) {
    // There is nowhere to show this. What a sign-in comes to is a state the
    // window reads, and a failure leaves that state exactly where it was.
    console.error('Foundry could not finish signing in:', error);
  }
}

/** The deep link that started this process, if one did. */
function launchedByDeepLink(): string | undefined {
  return process.argv.find((argument) => handoffToken(argument, SCHEME) !== null);
}

/** The last argument of a command line, which is where a deep link arrives. */
function lastArgument(commandLine: unknown): string | undefined {
  return Array.isArray(commandLine) ? commandLine.at(-1) : undefined;
}

/**
 * Claim the custom protocol, and be the only copy of the app running.
 *
 * Both have to happen before the app is ready: a scheme can only be registered
 * before then, and a second copy would be a second listener for the link that
 * is about to arrive. Answers whether this copy is the one that keeps running.
 */
function claimTheScheme(): boolean {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { secure: true } }]);

  // In development the app is Electron running a script, so what the system has
  // to call back is Electron itself with that script as its argument.
  const launched = process.argv[1];
  const claimed =
    process.defaultApp && launched !== undefined
      ? app.setAsDefaultProtocolClient(SCHEME, process.execPath, [resolve(launched)])
      : app.setAsDefaultProtocolClient(SCHEME);

  if (!claimed) console.error(`Foundry could not claim the ${SCHEME} protocol.`);

  // A second copy exists only to hand its command line to the first one, which
  // is how a deep link reaches an app that is already running.
  if (!app.requestSingleInstanceLock()) {
    app.quit();

    return false;
  }

  app.on(
    'second-instance',
    async (_event, commandLine: unknown, _folder: unknown, extra: unknown) => {
      // macOS keeps the app alive with no window, so a link can arrive with
      // nowhere to land.
      if (mainWindow === undefined) await createWindow();
      focusTheWindow();
      await takeDeepLink(typeof extra === 'string' ? extra : lastArgument(commandLine));
    },
  );

  // On macOS a deep link arrives as an event rather than as an argument.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    void takeDeepLink(url);
  });

  return true;
}

// A copy that did not get the lock is on its way out, having handed its command
// line to the copy that did, and has nothing to boot.
if (claimTheScheme()) {
  void app
    .whenReady()
    .then(async () => {
      // Foundry provides its own in-window controls; suppress Electron's default menu.
      Menu.setApplicationMenu(null);

      store = new ThreadStore(join(app.getPath('userData'), 'threads.db'));
      const secrets = secretKeeper();
      const mcpSecrets = mcpSecretStore({
        secrets,
        path: join(app.getPath('userData'), 'mcp-secrets'),
      });
      mcp = mcpManager({
        store,
        secrets: mcpSecrets,
        oauth: mcpOAuth({
          secrets: mcpSecrets,
          openExternal: async (url) => {
            await shell.openExternal(url.toString());
          },
        }),
      });
      // Global MCP servers are app configuration: begin them at launch without
      // making an unavailable server prevent the window from opening.
      void mcp.start();

      // The key store is one, and two things need it: signing in writes the key,
      // and the agent presents it to pi. The wire is one for the same reason —
      // signing in through it and asking it what it can serve
      // (docs/adr/0003-model-credentials.md).
      const keys = keyStore({
        secrets,
        path: join(app.getPath('userData'), 'key.json'),
      });
      const wire = foundryFor({ server: SERVER, scheme: SCHEME });

      models = foundryModels({
        server: SERVER,
        cachePath: join(app.getPath('userData'), 'models.json'),
        token: async () => (await keys.read())?.key ?? null,
        catalog: (token) => wire.catalog(token),
      });

      usage = usageFor({
        token: async () => (await keys.read())?.key ?? null,
        read: (token) => wire.usage(token),
      });

      memory = memoryFor({
        token: async () => (await keys.read())?.key ?? null,
        read: (token) => wire.memory(token),
        write: (token, decided) => wire.saveMemory(token, decided),
      });

      // The tracker, over the same key and the desktop's own answer about which
      // project a folder works. Nothing is kept: a queue is read when the surface
      // is looked at, and a cached one would be a queue that is already wrong.
      tracker = trackerFor({
        token: async () => (await keys.read())?.key ?? null,
        projectOf: (workspaceId) => store.findWorkspace(workspaceId)?.projectId ?? null,
        joinLocally: (workspaceId, projectId) => {
          const joined = store.joinWorkspace(workspaceId, projectId);

          return joined === undefined ? undefined : workspaceSummaryOf(joined);
        },
        wire,
      });

      // The worker: what this desktop offers while it is running and somebody is
      // signed in. Its name for the server is derived from the person and the machine
      // rather than written down, so the same laptop is the same worker after a
      // restart — and two people on one machine are two workers, neither holding the
      // other's claims. It takes nothing on its own: it says it is here, and a person
      // starts what runs (docs/adr/0012).
      worker = workerFor({
        token: async () => await keys.read(),
        device: hostname(),
        workspaces: () => store.listWorkspaces().map((each) => each.folder),
        // Asked on the way out rather than watched: a machine with a run in flight keeps
        // its claim, and goes quiet instead of saying goodbye (GH #74).
        driving: () => runs.driving(),
        wire,
      });

      const prepareMcpWorkspace = (workspaceId: string): Promise<void> =>
        mcp.connectWorkspace(workspaceId);
      questionnaires = new Questionnaires(pushEvent);
      chats = openChats(
        store,
        pushEvent,
        newWorkspace,
        models,
        () => memory.current(),
        tracker,
        mcp,
        prepareMcpWorkspace,
        questionnaires,
      );

      // Running a ticket. The checkout goes under the app's own data rather than beside
      // the person's folder, because it is Foundry's scratch space and not their work —
      // and the branch it makes is theirs, which is why the checkout can be thrown away
      // and the branch cannot.
      runs = runsFor({
        token: async () => (await keys.read())?.key ?? null,
        workerOf: () => worker.id(),
        folderOf: (workspaceId) => store.findWorkspace(workspaceId)?.folder,
        thereFor: (ticketId) => join(app.getPath('userData'), 'runs', ticketId),
        // Asked when Run is pressed rather than watched while the run goes: work that
        // cannot be paid for should not begin (docs/adr/0013).
        affordable: () => {
          const now = usage.current();

          return now === null || now.used < now.allowance;
        },
        worktrees: runWorktrees(),
        chatFor: (ticket, folder, id, workspaceId) =>
          startRunChat({
            store,
            models,
            memory: () => memory.current(),
            ticket,
            workspaceId,
            folder,
            id,
            // The window is given the conversation the run is going in, so that opening
            // the row steers the run rather than resuming a second session onto it.
            adopt: (conversation) => chats.adopt(conversation),
            tracker,
            mcp,
            questionnaires,
            prepareWorkspace: prepareMcpWorkspace,
          }),
        wire,
      });
      auth = signIn({
        keys,
        foundry: wire,
        device: hostname(),
        onChange: (state) => void signedInAs(state),
      });

      registerChatChannels();
      registerUsageChannels();
      registerMemoryChannels();
      registerMcpChannels();
      registerBrowserChannels();
      registerModelChannels();
      registerWorkspaceChannels();
      registerTrackerChannels();
      registerWorkerChannel();
      registerRunChannel();
      registerFileChannels();
      registerAuthChannels(auth);
      registerUpdateChannels();
      registerShellChannels();
      await createWindow();
      void desktopUpdates.start();

      // What the server can serve is read again without anything waiting on it,
      // so a machine that was already signed in does not run on a list from
      // whenever it last asked. Until it lands, the remembered list is what a
      // session runs on — and a machine that remembers nothing has no chat to
      // open until it does, because there is nothing yet to run one on. So a
      // chat is looked for again once the answer is in: without that, a first
      // launch after signing in elsewhere, or a catalog that could not be read
      // back, leaves the window saying there is no chat when the server was
      // ready to serve one all along.
      void models.refresh().then(() => showAChat());
      // And what this person has used, for the same reason: a window that opens
      // mid-month should show the month it is actually in.
      void usage.refresh();
      void memory.refresh();

      // And who is signed in, asked at boot rather than waited for. Most launches are of a
      // machine somebody signed in on days ago, and nothing changes on those — so a desktop
      // that only offered itself when the answer *changed* offered itself never, which left
      // its claims unrefreshed and its queue saying a machine was away when it was sitting
      // right there (GH #72).
      void auth.current().then((state) => signedInAs(state));

      // A link that started this copy is a sign-in that was started before
      // there was a window to be returned to, which is the shape of a first
      // sign-in on a machine that had never run Foundry.
      void takeDeepLink(launchedByDeepLink());

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createWindow();
        }
      });
    })
    .catch((error: unknown) => {
      // A conversation is opened before the window exists, so a failure here —
      // no model credentials, a database from a newer build — has nowhere to be
      // shown. A key that cannot be read is not one of these: the key store
      // answers "not signed in" for every way a key can fail to be read, so it
      // never reaches this (docs/adr/0006-key-storage.md).
      console.error('Foundry could not start:', error);
      app.quit();
    });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * Saying goodbye on the way out.
 *
 * A worker that has stopped being heard from keeps its claims, which is right for a
 * machine that crashed and wrong for one that is closing: those tickets are not being
 * worked any more, and the thing that makes them claimable again is this goodbye. So
 * the quit is held for it — once, and briefly, because a server that cannot be reached
 * must not make the window unclosable.
 */
let saidGoodbye = false;

app.on('before-quit', (event) => {
  if (saidGoodbye) return;

  saidGoodbye = true;
  event.preventDefault();
  void Promise.all([
    worker === undefined ? undefined : worker.stop(),
    mcp === undefined ? undefined : mcp.close(),
  ]).finally(() => app.quit());
});
