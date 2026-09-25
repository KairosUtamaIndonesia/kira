/**
 * Watching the folder the workbench shows.
 *
 * Kira writes into the chat's workspace while the chat runs, and the Workbench
 * sits beside that chat drawing the same folder, so the tree is told rather than
 * asked again at moments of our choosing (ADR 0016). This is Node's own
 * `fs.watch` and it is deliberately the whole of it: no watcher dependency is
 * taken on, because everything the platform does not promise has to be answered
 * by reading the folder again anyway.
 *
 * It watches the levels it is given — the levels the pane is showing — and
 * nothing else. Watching the folder recursively was tried and is wrong here:
 * `fs.watch(folder, { recursive: true })` walks the whole tree and adds a watch
 * per directory before it returns, which for a workspace holding an ignored
 * `node_modules` is about 3.7 seconds of a blocked main process — every IPC
 * behind it, the listing of the tree included, which is a tab that hangs until
 * the walk finishes — and 132,173 inotify watches spent on folders nobody is
 * looking at. Naming the levels costs one watch each and returns at once, and a
 * folder is named when it is opened, so nothing on screen goes unwatched.
 *
 * Nothing here decides what a change means. A change is one call, and which
 * folders to read again is the pane's to say — it is the pane that knows which
 * of them are on screen.
 */
import { watch, type FSWatcher } from 'node:fs';

/**
 * How long a burst is gathered for. Short enough that the tree is never visibly
 * behind the conversation beside it, long enough that a run writing twenty files
 * is one read rather than twenty.
 */
const QUIET_MS = 120;

/**
 * The longest a burst is gathered for, however much keeps happening.
 *
 * A turn writing files throughout would otherwise hold the quiet window open for
 * as long as it lasts, and the tree would sit still until the turn ended — which
 * is the whole time it is most worth watching.
 */
const LONGEST_MS = 1000;

/** A watch, until it is stopped. */
export interface Watching {
  /** Stop watching. What happens afterwards is not a change to answer. */
  stop(): void;
}

/**
 * Something happening, gathered into one call.
 *
 * The events a platform reports for one thing Kira does arrive in whatever
 * number it felt like — a file written, a folder touched, the same path twice —
 * and what the tree wants is one answer to all of them. Each event pushes the
 * call out, and the first one also starts a wait that nothing restarts, so a
 * burst is answered once and a run that never pauses is answered anyway.
 */
function coalesce(run: () => void): { happened(): void; stop(): void } {
  let quiet: NodeJS.Timeout | null = null;
  let longest: NodeJS.Timeout | null = null;
  let stopped = false;

  function clear(): void {
    if (quiet !== null) clearTimeout(quiet);
    if (longest !== null) clearTimeout(longest);

    quiet = null;
    longest = null;
  }

  function answer(): void {
    clear();
    if (!stopped) run();
  }

  return {
    happened: () => {
      // A watch being closed can still deliver an event that was already on its
      // way, and the pane that asked for it is being put away by then.
      if (stopped) return;
      if (quiet !== null) clearTimeout(quiet);

      quiet = setTimeout(answer, QUIET_MS);
      longest ??= setTimeout(answer, LONGEST_MS);
    },
    stop: () => {
      stopped = true;
      clear();
    },
  };
}

/**
 * Watch the levels named, answering a way to stop — or null when the platform
 * will not watch any of them.
 *
 * A level that cannot be watched is skipped rather than failing the rest. A
 * folder that has gone since it was read, or one the platform refuses, is a
 * level there is nothing to keep up with, and the tree reads the folder either
 * way — which is why none of this is a failure to show: a tree that said a
 * folder was empty because its watch failed would be a lie about the folder
 * rather than about the watch.
 *
 * `changed` is called once for a burst rather than once per event, and it is
 * given nothing: what a change means is the pane's to say.
 */
export function watchFolders(folders: readonly string[], changed: () => void): Watching | null {
  const burst = coalesce(changed);
  const watchers: FSWatcher[] = [];

  for (const folder of folders) {
    try {
      const watcher = watch(folder);

      watcher.on('change', () => {
        burst.happened();
      });
      /*
       * A watch that fails after it started — a folder replaced by a fresh
       * checkout follows a different inode, a filesystem that stops answering —
       * is not a change to apply: the tree keeps what it has, and the next time
       * the folder is read it says what is really there (ADR 0016). This
       * listener is also what keeps a failed watch from being thrown at the
       * process, since an `error` with nobody listening is an unhandled event.
       */
      watcher.on('error', () => {});

      watchers.push(watcher);
    } catch {
      // Nothing to watch at this level. The others still are.
    }
  }

  if (watchers.length === 0) {
    burst.stop();

    return null;
  }

  return {
    stop: () => {
      burst.stop();

      for (const watcher of watchers) watcher.close();
    },
  };
}
