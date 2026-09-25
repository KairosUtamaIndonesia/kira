import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import type { ChatMode } from '../../preload/bridge.ts';
import type { ThreadStore } from '../db/threads.ts';
import type { MemorySource } from '../memory.ts';
import type { Tracker } from '../tracker.ts';
import type { McpManager } from '../mcp/servers.ts';
import type { Questionnaires } from '../questionnaires.ts';
import { kiraExtension } from './extension/factory.ts';
import { bundledSkillsPath } from './resources.ts';
import type { Models } from './models.ts';
import { createThread, forkThread, openThread, type PiThread } from './storage.ts';

/**
 * A running conversation.
 *
 * Close it with `dispose()`. pi keeps provider connections and timers alive, so
 * a session that is dropped without being disposed stops the process from exiting.
 */
export interface KiraSession {
  readonly threadId: string;
  readonly cwd: string;
  readonly session: AgentSession;
  /** Change the shell used for this session's next Bash command. */
  setShellPath(path: string | undefined): Promise<void>;
  dispose(): void;
}

export type WorkspacePreparer = (workspaceId: string) => Promise<void>;

/** Start a new conversation in `cwd`, storing it in the database. */
export async function startSession(
  store: ThreadStore,
  cwd: string,
  models: Models,
  options: {
    id?: string;
    workspaceId?: string;
    modelId?: string;
    ticketId?: string;
    mode?: ChatMode;
  } = {},
  memorySettings?: MemorySource,
  tracker?: Tracker,
  mcp?: McpManager,
  prepareWorkspace?: WorkspacePreparer,
  questionnaires?: Questionnaires,
): Promise<KiraSession> {
  return boot(
    store,
    createThread(store, cwd, options),
    models,
    options.modelId ?? null,
    memorySettings,
    tracker,
    mcp,
    prepareWorkspace,
    questionnaires,
  );
}

/** Reopen a stored conversation, restoring its entries, its leaf and its model. */
export async function resumeSession(
  store: ThreadStore,
  threadId: string,
  models: Models,
  memorySettings?: MemorySource,
  tracker?: Tracker,
  mcp?: McpManager,
  prepareWorkspace?: WorkspacePreparer,
  questionnaires?: Questionnaires,
): Promise<KiraSession> {
  return boot(
    store,
    openThread(store, threadId),
    models,
    store.getThread(threadId).modelId,
    memorySettings,
    tracker,
    mcp,
    prepareWorkspace,
    questionnaires,
  );
}

/**
 * Start a conversation holding `sourceThreadId`'s words up to `messageId`.
 *
 * The fork runs on the model its source runs on: it is the same conversation up
 * to a point and carries on from there, so it carries on on the same model —
 * which booting then writes down as the fork's own.
 */
export async function forkSession(
  store: ThreadStore,
  sourceThreadId: string,
  messageId: string,
  models: Models,
  memorySettings?: MemorySource,
  tracker?: Tracker,
  mcp?: McpManager,
  prepareWorkspace?: WorkspacePreparer,
  questionnaires?: Questionnaires,
): Promise<KiraSession> {
  const forked = forkThread(store, sourceThreadId, messageId);

  return boot(
    store,
    forked,
    models,
    store.getThread(sourceThreadId).modelId,
    memorySettings,
    tracker,
    mcp,
    prepareWorkspace,
    questionnaires,
  );
}

/**
 * Boot a session for `thread`, on the model `wanted` names.
 *
 * The model is always handed over rather than left to pi to restore from the
 * session it is opening, because what pi would restore is a model named by
 * whatever wrote the chat — including an install that ran on pi's own provider,
 * for which pi holds a credential (docs/adr/0003-model-credentials.md). Asking
 * for it by id here is what makes that unreachable: a model Kira does not
 * offer is not found, and the chat runs on what the pool prefers instead.
 */
async function boot(
  store: ThreadStore,
  thread: PiThread,
  models: Models,
  wanted: string | null,
  memorySettings?: MemorySource,
  tracker?: Tracker,
  mcp?: McpManager,
  prepareWorkspace?: WorkspacePreparer,
  questionnaires?: Questionnaires,
): Promise<KiraSession> {
  // What this runs on comes from the server, and so does the runtime it runs on:
  // the desktop holds no provider credential and no list of models of its own
  // (docs/adr/0003-model-credentials.md). Nothing to run is a machine that has
  // not signed in, or a server that cannot offer anything, and either way it is
  // said rather than worked around.
  const remembered = wanted === null ? null : await models.find(wanted);
  const choice = remembered ?? (await models.preferred());
  if (choice === null) {
    throw new Error(
      'Kira is not offering any models. Sign in, and check that the server can reach its pool.',
    );
  }

  // The session's services are built in two steps rather than one, because this is
  // where Kira's own extension joins them: pi builds the resource loader from
  // these options, so the extension arrives through the same construction as
  // every other resource pi loads — rather than a loader of Kira's own, which
  // would be a second copy of pi's that an upgrade could quietly diverge from.
  const workspaceId = store.getThread(thread.threadId).workspaceId;
  if (workspaceId !== null) {
    if (mcp !== undefined && prepareWorkspace === undefined) {
      throw new Error('Workspace MCP preparation is required for workspace chats.');
    }
    await prepareWorkspace?.(workspaceId);
  }

  let cleanupMcpSubscription: (() => void) | undefined;
  let session: AgentSession | undefined;
  try {
    const services = await createAgentSessionServices({
      cwd: thread.cwd,
      modelRuntime: choice.runtime,
      resourceLoaderOptions: {
        additionalSkillPaths: [bundledSkillsPath()],
        extensionFactories: [
          kiraExtension({
            cwd: thread.cwd,
            store,
            threadId: thread.threadId,
            workspaceId,
            models,
            memorySettings,
            tracker,
            mcp,
            questionnaires,
            getShellPath: () => services.settingsManager.getShellPath(),
            registerCleanup: (cleanup) => {
              cleanupMcpSubscription = cleanup;
            },
          }),
        ],
      },
    });

    session = (
      await createAgentSessionFromServices({
        services,
        sessionManager: thread.sessionManager,
        model: choice.model,
      })
    ).session;

    // Written down here rather than where a model is chosen, because this is where
    // the chat's model is settled — including when the remembered one is gone and
    // this is the pool's preference instead. The row then says what the chat has
    // actually been running on, which is what reopening it comes back to.
    store.setThreadModel(thread.threadId, choice.model.id);
  } catch (error) {
    cleanupMcpSubscription?.();
    session?.dispose();
    throw error;
  }

  const activeSession = session!;
  let disposed = false;
  return {
    threadId: thread.threadId,
    cwd: thread.cwd,
    session: activeSession,
    async setShellPath(path) {
      activeSession.settingsManager.setShellPath(path);
      await activeSession.settingsManager.flush();
      const errors = activeSession.settingsManager.drainErrors();
      if (errors.length > 0) throw errors[0]!.error;
      // Pi snapshots shellPath when it builds the Bash tool, so rebuild it now
      // for this already-open session to use the saved executable next time.
      await activeSession.reload();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cleanupMcpSubscription?.();
      activeSession.dispose();
    },
  };
}
