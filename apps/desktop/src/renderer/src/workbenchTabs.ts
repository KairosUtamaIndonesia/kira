/**
 * The workbench's tabs: what this chat has open, and which of them is showing.
 *
 * The files a chat has open are the chat's own, so every rule here is asked for
 * one chat's tabs — a chat opened beside this one keeps what it had, and nothing
 * carries across a switch. That is also where the strip's shape lives: the pane's
 * own tabs and the files are peers, ordered by when each file was opened, so a
 * file the reader comes back to is where they left it rather than appended.
 *
 * Kept out of the component that paints it, the way the tree's rows are, so what
 * a click does — opens, brings forward, closes and shows what took the closed
 * tab's place — is checkable without a DOM.
 */
import type { Result } from '../../preload/bridge';

/** What Kira is holding for the chat, which is the tab the pane opens on. */
export const CONTEXT = 'context';

/** The chat's own workspace, which is where its files are opened from. */
export const WORKSPACE = 'workspace';
/** The agreed spec, rendered as Markdown rather than a plain-text draft. */
export const SPEC = 'spec';
/** Tickets under the agreed spec, with their server-derived bands. */
export const TICKETS = 'tickets';
/** Browser pages held beside this chat. */
export const BROWSER = 'browser';

/**
 * How a file's tab is named among the pane's own. Prefixed so that a file called
 * `workspace` — or `context`, or anything else a tab value could be — has a tab
 * of its own rather than being mistaken for the pane's.
 */
const FILE = 'file:';

/** The tab a file's path is drawn by. */
export function valueOf(path: string): string {
  return `${FILE}${path}`;
}

/**
 * What a file's tab is labelled with: its own name, which is what a reader looks
 * for. Two files of the same name are told apart by the tree they were opened
 * from, which knows which folder each came out of.
 */
export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** What one chat has open, and which of its tabs is showing. */
export interface Tabs {
  /** The files this chat has open, in the order they were opened. */
  open: readonly string[];
  /** The tab showing: one of the pane's own, or a file's. */
  showing: string;
}

/** What every chat has open. A chat that has opened nothing is not in here. */
export type ByChat = ReadonlyMap<string, Tabs>;

/** What a chat has open, or the first relevant pane tab for a new chat. */
export function tabsOf(all: ByChat, chatId: string, initialTab = CONTEXT): Tabs {
  return all.get(chatId) ?? { open: [], showing: initialTab };
}

/** Open a file, or bring the tab it already has forward. */
export function opened(all: ByChat, chatId: string, path: string): ByChat {
  const tabs = tabsOf(all, chatId);

  return withTabs(all, chatId, {
    open: tabs.open.includes(path) ? tabs.open : [...tabs.open, path],
    showing: valueOf(path),
  });
}

/** Show one of this chat's tabs. */
export function shown(all: ByChat, chatId: string, value: string): ByChat {
  return withTabs(all, chatId, { ...tabsOf(all, chatId), showing: value });
}

/**
 * Close a file's tab. The pane stays: closing the last file shows the chat's
 * workspace, which is where its files are opened from in the first place.
 *
 * The file that takes the closed tab's place is the next one along the strip,
 * and the one before it when there is no next — so closing the rightmost file
 * leaves the reader where they were rather than at the far end of the strip.
 */
export function closed(all: ByChat, chatId: string, path: string): ByChat {
  const tabs = tabsOf(all, chatId);
  const at = tabs.open.indexOf(path);

  // Nothing to close, so nothing changed — the same map, not an equal one, so
  // an impossible click does not redraw the pane.
  if (at === -1) return all;

  return withTabs(all, chatId, {
    open: tabs.open.filter((held) => held !== path),
    showing: tabs.showing === valueOf(path) ? neighbourOf(tabs.open, at) : tabs.showing,
  });
}

/** What a file turned out to hold, once it has been read. */
export type Reading =
  | { kind: 'text'; text: string }
  /** Refused: too large to read, or not text. Said where the contents would be. */
  | { kind: 'refused'; reason: string };

/** A file that could not be read says why, rather than showing an empty tab. */
export function contentsOf(result: Result<string>): Reading {
  return result.ok
    ? { kind: 'text', text: result.value }
    : { kind: 'refused', reason: result.error };
}

/** The tab that takes the place of the one closed at `at`. */
function neighbourOf(open: readonly string[], at: number): string {
  const taking = open[at + 1] ?? open[at - 1];

  return taking === undefined ? WORKSPACE : valueOf(taking);
}

function withTabs(all: ByChat, chatId: string, tabs: Tabs): ByChat {
  return new Map(all).set(chatId, tabs);
}
