/**
 * The local-git channels' handlers.
 *
 * The window names a chat and paths inside that chat's workspace, and nothing
 * else: the folder the paths are resolved against comes from the chat's own
 * record, so no absolute path is said by the renderer. This is the chat's own
 * checkout, not a Git host — `ipc/git.ts` holds the hosts this server is
 * connected to, and the two never share a word.
 *
 * Every command is handed in, so a chat with no workspace, a path climbing out,
 * a folder that is not a checkout and git's own refusal are all reachable
 * without a filesystem.
 */
import {
  type ChangedPath,
  type CommitSummary,
  type GitSyncAction,
  WORKSPACE_GIT_CHANNELS,
  type Result,
  type WorkspaceGitStatus,
} from '../../preload/bridge.ts';
import { insideWorkspace } from './files.ts';
import { envelope } from './result.ts';

export { WORKSPACE_GIT_CHANNELS };

/** What the handlers need from the main process. */
export interface WorkspaceGitDeps {
  /** The folder a chat works in, or null when no chat is stored under that id. */
  workspaceOf(chatId: string): string | null;
  status(root: string): Promise<WorkspaceGitStatus>;
  /** One path's patch: in the index when `staged`, in the working tree otherwise. */
  patch(root: string, path: string, staged: boolean): Promise<string>;
  stage(root: string, paths: readonly string[]): Promise<void>;
  unstage(root: string, paths: readonly string[]): Promise<void>;
  applyHunk(root: string, patch: string, reverse: boolean): Promise<void>;
  commit(root: string, message: string): Promise<void>;
  revert(root: string, path: string): Promise<void>;
  branches(root: string): Promise<{ branches: string[]; current: string | null }>;
  checkout(root: string, branch: string): Promise<void>;
  log(root: string, limit: number): Promise<CommitSummary[]>;
  commitFiles(root: string, hash: string): Promise<ChangedPath[]>;
  sync(root: string, action: GitSyncAction): Promise<string>;
}

export interface WorkspaceGitHandlers {
  status(chatId: unknown): Promise<Result<WorkspaceGitStatus>>;
  patch(chatId: unknown, path: unknown, staged: unknown): Promise<Result<string>>;
  stage(chatId: unknown, paths: unknown): Promise<Result<null>>;
  unstage(chatId: unknown, paths: unknown): Promise<Result<null>>;
  applyHunk(chatId: unknown, patch: unknown, reverse: unknown): Promise<Result<null>>;
  commit(chatId: unknown, message: unknown): Promise<Result<null>>;
  revert(chatId: unknown, path: unknown): Promise<Result<null>>;
  branches(chatId: unknown): Promise<Result<{ branches: string[]; current: string | null }>>;
  checkout(chatId: unknown, branch: unknown): Promise<Result<null>>;
  log(chatId: unknown, limit: unknown): Promise<Result<CommitSummary[]>>;
  commitFiles(chatId: unknown, hash: unknown): Promise<Result<ChangedPath[]>>;
  sync(chatId: unknown, action: unknown): Promise<Result<string>>;
}

/** How large a patch the window may send to be applied to the index. */
const PATCH_CAP = 1024 * 1024;

export function workspaceGitHandlers(deps: WorkspaceGitDeps): WorkspaceGitHandlers {
  const {
    workspaceOf,
    status,
    patch,
    stage,
    unstage,
    applyHunk,
    commit,
    revert,
    branches,
    checkout,
    log,
    commitFiles,
    sync,
  } = deps;

  function rootOf(chatId: unknown): string | null {
    if (typeof chatId !== 'string' || chatId === '') {
      throw new Error('A checkout is read for a chat, and none was named.');
    }

    return workspaceOf(chatId);
  }

  /** A folder to run in, or a refusal saying the chat has no workspace yet. */
  function rootFor(chatId: unknown): string {
    const root = rootOf(chatId);
    if (root === null) throw new Error('This chat has no workspace yet.');

    return root;
  }

  /** One path inside the chat's workspace, or a refusal. */
  function pathFor(chatId: unknown, path: unknown): { root: string; path: string } {
    if (typeof path !== 'string') {
      throw new Error(
        'The changes view asks for a path inside the workspace, and that was not one.',
      );
    }
    const root = rootFor(chatId);

    return { root, path: insideWorkspace(root, path) };
  }

  /** The paths of a stage or unstage, each checked and non-empty. */
  function pathsFor(chatId: unknown, paths: unknown): { root: string; paths: string[] } {
    const root = rootFor(chatId);
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('The changes view names no files to change.');
    }

    return {
      root,
      paths: paths.map((path) => {
        if (typeof path !== 'string' || path === '') {
          throw new Error('A file has to be named to change its staging.');
        }

        return insideWorkspace(root, path);
      }),
    };
  }

  return {
    status: (chatId) => envelope(async () => status(rootFor(chatId))),

    patch: (chatId, path, staged) =>
      envelope(async () => {
        const asked = pathFor(chatId, path);
        if (typeof staged !== 'boolean') throw new Error('A patch is either in the index or not.');

        return patch(asked.root, asked.path, staged);
      }),

    stage: (chatId, paths) =>
      envelope(async () => {
        const asked = pathsFor(chatId, paths);
        await stage(asked.root, asked.paths);

        return null;
      }),

    unstage: (chatId, paths) =>
      envelope(async () => {
        const asked = pathsFor(chatId, paths);
        await unstage(asked.root, asked.paths);

        return null;
      }),

    applyHunk: (chatId, patchText, reverse) =>
      envelope(async () => {
        const root = rootFor(chatId);
        if (typeof patchText !== 'string' || patchText === '') {
          throw new Error('A hunk has to be named to be staged.');
        }
        if (patchText.length > PATCH_CAP) {
          throw new Error('That hunk is larger than the workbench handles.');
        }
        if (typeof reverse !== 'boolean')
          throw new Error('A hunk is staged or unstaged, not both.');

        await applyHunk(root, patchText, reverse);

        return null;
      }),

    commit: (chatId, message) =>
      envelope(async () => {
        const root = rootFor(chatId);
        if (typeof message !== 'string') throw new Error('A commit needs a message.');

        await commit(root, message);

        return null;
      }),

    revert: (chatId, path) =>
      envelope(async () => {
        const asked = pathFor(chatId, path);
        await revert(asked.root, asked.path);

        return null;
      }),

    branches: (chatId) => envelope(async () => branches(rootFor(chatId))),

    checkout: (chatId, branch) =>
      envelope(async () => {
        const root = rootFor(chatId);
        if (typeof branch !== 'string' || branch === '') {
          throw new Error('A branch has to be named to be switched to.');
        }

        await checkout(root, branch);

        return null;
      }),

    log: (chatId, limit) =>
      envelope(async () => {
        const root = rootFor(chatId);
        if (typeof limit !== 'number' || !Number.isFinite(limit)) {
          throw new Error('History needs a number of commits to read.');
        }

        return log(root, limit);
      }),

    commitFiles: (chatId, hash) =>
      envelope(async () => {
        const root = rootFor(chatId);
        if (typeof hash !== 'string' || hash === '') throw new Error('A commit has to be named.');

        return commitFiles(root, hash);
      }),

    sync: (chatId, action) =>
      envelope(async () => {
        const root = rootFor(chatId);
        if (action !== 'fetch' && action !== 'pull' && action !== 'push') {
          throw new Error('A checkout can be fetched, pulled or pushed.');
        }

        return sync(root, action);
      }),
  };
}
