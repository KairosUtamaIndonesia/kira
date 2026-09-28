/**
 * The workbench's open files and selected view, kept separate so editor tabs
 * stay selected while someone visits another workbench view.
 *
 * The files a chat has open are the chat's own, so every rule here is asked for
 * one chat — a chat opened beside this one keeps what it had, and nothing carries
 * across a switch. Open files stay ordered by when each was opened.
 *
 * Kept out of the component that paints it, the way the tree's rows are, so what
 * a click does — opens, selects, closes and chooses the neighbouring file — is
 * checkable without a DOM.
 */
import type { Result, WorkspaceAsset } from '../../preload/bridge';

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
  /** Which workbench view is showing. Open files are shown inside Workspace. */
  showing: string;
  /** The selected file tab in Workspace, if there is one. */
  selectedFile: string | null;
}

/** What every chat has open. A chat that has opened nothing is not in here. */
export type ByChat = ReadonlyMap<string, Tabs>;

/** What a chat has open, or the first relevant pane tab for a new chat. */
export function tabsOf(all: ByChat, chatId: string, initialTab = CONTEXT): Tabs {
  return all.get(chatId) ?? { open: [], showing: initialTab, selectedFile: null };
}

/** Open a file in the Workspace editor, or bring its tab forward. */
export function opened(all: ByChat, chatId: string, path: string): ByChat {
  const tabs = tabsOf(all, chatId);

  return withTabs(all, chatId, {
    open: tabs.open.includes(path) ? tabs.open : [...tabs.open, path],
    showing: WORKSPACE,
    selectedFile: path,
  });
}

/** Show a workbench view or select one of Workspace's open files. */
export function shown(all: ByChat, chatId: string, value: string): ByChat {
  const tabs = tabsOf(all, chatId);
  const file = tabs.open.find((path) => valueOf(path) === value);

  return withTabs(
    all,
    chatId,
    file === undefined
      ? { ...tabs, showing: value }
      : { ...tabs, showing: WORKSPACE, selectedFile: file },
  );
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
    showing: tabs.showing,
    selectedFile: tabs.selectedFile === path ? neighbourOf(tabs.open, at) : tabs.selectedFile,
  });
}

/** What a file turned out to hold, once it has been read. */
export type Reading =
  | { kind: 'text'; text: string }
  | { kind: 'asset'; dataUrl: string; mimeType: string; sizeBytes: number }
  /** Refused: too large to read, or not text. Said where the contents would be. */
  | { kind: 'refused'; reason: string };

/** A file that could not be read says why, rather than showing an empty tab. */
export function contentsOf(result: Result<string>): Reading {
  return result.ok
    ? { kind: 'text', text: result.value }
    : { kind: 'refused', reason: result.error };
}

/** A binary preview asset, or its refusal, held beside the text readings. */
export function assetContentsOf(result: Result<WorkspaceAsset>): Reading {
  return result.ok ? { kind: 'asset', ...result.value } : { kind: 'refused', reason: result.error };
}

/** The tab that takes the place of the one closed at `at`. */
function neighbourOf(open: readonly string[], at: number): string | null {
  return open[at + 1] ?? open[at - 1] ?? null;
}

function withTabs(all: ByChat, chatId: string, tabs: Tabs): ByChat {
  return new Map(all).set(chatId, tabs);
}
