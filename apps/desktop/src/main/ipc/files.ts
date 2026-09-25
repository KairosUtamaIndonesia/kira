/**
 * The file channels' handlers.
 *
 * The window names a chat and a path inside that chat's workspace, and nothing
 * else: the folder comes from the chat's own record, so no absolute path is ever
 * said by the renderer and a path that would climb out of the workspace is
 * refused. That is a default rather than a boundary — ADR 0001 gives Kira a
 * terminal's reach — but a workbench that could name any path would be a second
 * way to read the whole disk, which is not a thing anyone asked for.
 *
 * Listing and reading are handed in, so a chat with no workspace, an unreadable
 * folder and a refusal are all reachable without touching a filesystem. Watching
 * is handed in the same way, and a watch is held per window rather than per
 * chat: the pane shows one folder at a time, so a second watch is the pane
 * moving rather than a second folder to keep up with.
 */
import { resolve, sep } from 'node:path';
import { FILE_CHANNELS, type FolderListing, type Result } from '../../preload/bridge.ts';
import { envelope } from './result.ts';

export { FILE_CHANNELS };

/**
 * A watch, as much of one as these handlers need: a way to stop it. Levels the
 * platform will not watch are null rather than a watch that never fires, and
 * are not a failure — the tree reads the folder just the same.
 */
export interface Watching {
  stop(): void;
}

/** What the handlers need from the main process. */
export interface FileDeps {
  /** The folder a chat works in, or null when no chat is stored under that id. */
  workspaceOf(chatId: string): string | null;
  /** What one folder of a workspace holds, by a path from its root. */
  list(root: string, path: string): Promise<FolderListing>;
  /** One file's text, by a path from the workspace root. */
  read(root: string, path: string): Promise<string>;
  /**
   * Watch the levels named — each one a folder — answering a way to stop, or
   * null when the platform will not watch any of them, which is not a failure to
   * show. `changed` is called once for a burst of changes rather than once each.
   */
  watch(folders: readonly string[], changed: () => void): Watching | null;
}

export interface FileHandlers {
  list(chatId: unknown, path: unknown): Promise<Result<FolderListing | null>>;
  read(chatId: unknown, path: unknown): Promise<Result<string>>;
  /**
   * Watch the levels of the chat's workspace that one window is showing, so
   * changes reach the tree. `key` is which window, and one set of levels per
   * window at a time: watching again replaces what that window was watching
   * rather than adding to it.
   */
  watch(key: number, chatId: unknown, paths: unknown, changed: () => void): Promise<Result<null>>;
  /** Stop watching for a window: its pane was hidden, or its chat changed. */
  unwatch(key: number): Promise<Result<null>>;
}

export function fileHandlers({ workspaceOf, list, read, watch }: FileDeps): FileHandlers {
  /** What each window is watching, if anything. */
  const watching = new Map<number, Watching>();

  /** Stop what a window was watching, if it was watching anything. */
  function stop(key: number): void {
    watching.get(key)?.stop();
    watching.delete(key);
  }

  /**
   * The folder a chat works in, or null when nothing is stored under that id.
   *
   * That null is not a refusal. A chat nothing has been said in yet was never
   * stored, so there is no folder it works in — which is a chat with nothing to
   * show, and the workbench says so rather than being handed an empty folder it
   * would draw as one that exists and is empty.
   */
  function rootOf(chatId: unknown): string | null {
    if (typeof chatId !== 'string' || chatId === '') {
      throw new Error('A workspace is read for a chat, and none was named.');
    }

    return workspaceOf(chatId);
  }

  /**
   * The folder to look in and the path inside it, both checked, or null when the
   * chat has no workspace.
   */
  function target(chatId: unknown, path: unknown): { root: string; path: string } | null {
    // Checked before the workspace is looked for, because it needs nothing from
    // it: a path that is not a path is wrong whatever chat it was said about.
    if (typeof path !== 'string') {
      throw new Error('The workbench asks for a path inside the workspace, and that was not one.');
    }

    const root = rootOf(chatId);

    return root === null ? null : { root, path: inside(root, path) };
  }

  return {
    list: (chatId, path) =>
      envelope(async () => {
        const asked = target(chatId, path);

        return asked === null ? null : list(asked.root, asked.path);
      }),

    read: (chatId, path) =>
      envelope(async () => {
        const asked = target(chatId, path);

        if (asked === null) throw new Error('This chat has no workspace yet.');
        // The root is what a list with no path names, and it is not a file to
        // read, so a read that names nothing is refused rather than answered
        // with the folder's own failure to be one.
        if (asked.path === '') throw new Error('A file has to be named to be read.');

        return read(asked.root, asked.path);
      }),

    watch: (key, chatId, paths, changed) =>
      envelope(async () => {
        const root = rootOf(chatId);

        // Stopped before the next one starts, so a window is never watching two
        // sets of levels: what it was watching is the pane it is no longer
        // showing.
        stop(key);

        if (root === null) return null;
        if (!Array.isArray(paths)) {
          throw new Error(
            'The workbench asks for the levels it is showing, and that was not a list.',
          );
        }

        const started = watch(
          paths.map((path) => {
            if (typeof path !== 'string') {
              throw new Error(
                'The workbench asks for a path inside the workspace, and that was not one.',
              );
            }

            // Resolved against the root, because a level is watched as a folder
            // and the root itself is named by the empty path.
            return resolve(root, inside(root, path));
          }),
          changed,
        );
        // Levels the platform will not watch are still listed correctly, so a
        // watch that could not be made is nothing to report.
        if (started !== null) watching.set(key, started);

        return null;
      }),

    unwatch: (key) =>
      envelope(async () => {
        stop(key);

        return null;
      }),
  };
}

/**
 * A path that stays inside the workspace, or a refusal.
 *
 * Resolved rather than pattern-matched, so `..`, an absolute path and whatever
 * the separators are on this platform all come out the same way: the answer
 * either is the workspace or is under it. A symbolic link pointing out is
 * followed, because a path is not a boundary here (ADR 0001); what this keeps
 * out is the window naming a path of its own.
 */
function inside(root: string, path: string): string {
  const folder = resolve(root);
  const asked = resolve(folder, path);
  const below = folder.endsWith(sep) ? folder : folder + sep;

  if (asked !== folder && !asked.startsWith(below)) {
    throw new Error('That path is outside the chat’s workspace.');
  }

  return path;
}
