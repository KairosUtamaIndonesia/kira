/**
 * The order and the words a person reads what Kira is holding in.
 *
 * Pure, so the pane that draws it has nothing to work out: what a group is
 * called and which comes first is a judgement about the memory rather than about
 * the drawing, and it is the part worth a test.
 */
import type { ChatConclusion, ChatMemory, MemoryKind } from '../../preload/bridge.ts';

/**
 * What the pane groups by: the ledger's kinds, and the skills Kira loaded. A skill
 * is not a kind of its own in the ledger — Kira loads one by reading its
 * `SKILL.md`, which the ledger keeps as a file read — so it is told apart here.
 */
export type GroupKind = MemoryKind | 'skill';

/** What each kind is called where a person reads it. */
export const MEMORY_LABELS: Record<GroupKind, string> = {
  preference: 'What you asked for',
  goal: 'The work',
  skill: 'Skills',
  changed: 'Files changed',
  commit: 'Commits',
  read: 'Files read',
};

/**
 * Most important first, because the pane is read top-down and a person checking
 * Kira's memory is looking for the instruction they gave, not the file Kira opened.
 *
 * A `Record` rather than a list so that a kind added to `MemoryKind` fails to
 * compile until it is placed here — the failure worth having, since a kind left
 * out of a list would simply never be drawn.
 */
const ORDER: Record<GroupKind, number> = {
  preference: 0,
  goal: 1,
  skill: 2,
  changed: 3,
  commit: 4,
  read: 5,
};

/** One heading and what is under it. */
export interface MemoryGroup {
  kind: GroupKind;
  label: string;
  items: ChatMemory[];
}

/**
 * What Kira is holding, grouped by kind, most important first.
 *
 * A kind Kira holds nothing of is left out rather than drawn empty: a heading
 * with nothing under it reads as work that was lost rather than as work that was
 * never done. Within a group the order is the ledger's own — when the chat first
 * touched on it — which is the order it happened in.
 */
export function groupsIn(memory: readonly ChatMemory[]): MemoryGroup[] {
  const kinds = [...new Set(memory.map(groupKindOf))].sort(
    (left, right) => ORDER[left] - ORDER[right],
  );

  return kinds.map((kind) => ({
    kind,
    label: MEMORY_LABELS[kind],
    items: memory.filter((each) => groupKindOf(each) === kind),
  }));
}

/**
 * The group a thing is drawn under. A file Kira read that is a `SKILL.md` is a
 * skill she loaded — the same reading the transcript makes of that call — and
 * is drawn with the skills rather than with the files.
 */
function groupKindOf(item: ChatMemory): GroupKind {
  return item.kind === 'read' && basenameOf(item.text) === 'SKILL.md' ? 'skill' : item.kind;
}

const basenameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * A loaded skill as its name and the folder it was loaded from: the folder its
 * `SKILL.md` is in names it, and the folder above that says whose it is — Kira's
 * own, the person's, or the project's.
 */
export function skillParts(path: string): { name: string; folder: string } {
  return pathParts(pathParts(path).folder);
}

/** What a conclusion is called where a person reads it. */
export const CONCLUSION_LABEL = 'What Kira concluded';

/** What Kira has worked out, as one heading and what is under it. */
export interface ConclusionGroup {
  label: string;
  items: readonly ChatConclusion[];
}

/**
 * What Kira worked out, or nothing when Kira has worked nothing out.
 *
 * Nothing rather than an empty group, for the reason a kind Kira holds nothing of
 * gets no heading: a heading with nothing under it reads as work that was lost
 * rather than as work that was never done. There is no order to work out here —
 * the store answers them in the order Kira worked them out, which is the order to
 * read them in.
 */
export function conclusionGroupIn(conclusions: readonly ChatConclusion[]): ConclusionGroup | null {
  return conclusions.length === 0 ? null : { label: CONCLUSION_LABEL, items: conclusions };
}

/**
 * How far a conclusion had read, or null when that is not known.
 *
 * A turn number rather than a count of anything: it is the same number `recall`
 * answers to, so a person can ask what Kira was reading when Kira concluded it.
 * Not knowing is drawn as nothing rather than as a zero, because a conclusion
 * whose reach was never recorded still deserves reading.
 */
export function coverageLine(coversThrough: number | null): string | null {
  return coversThrough === null ? null : `Read through turn ${coversThrough}`;
}

/**
 * A remembered path as the file's name and the folder it is in, so a row can lead
 * with the name a reader looks for and leave the folder to trail after it. A path
 * with no folder has an empty one.
 */
export function pathParts(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf('/');
  return slash === -1
    ? { name: path, folder: '' }
    : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}

/**
 * A remembered commit as its hash and its subject. The ledger keeps them as one
 * line, `a1b2c3d: fix the deploy`; a line without that shape has no hash to lead
 * with, and is all subject.
 */
export function commitParts(text: string): { hash: string; subject: string } {
  const colon = text.indexOf(': ');
  return colon === -1
    ? { hash: '', subject: text }
    : { hash: text.slice(0, colon), subject: text.slice(colon + 2) };
}

/**
 * Whether a remembered path is one the workspace can open. The workspace reads
 * only what is inside the chat's folder, by a path relative to it, so a file Kira
 * read elsewhere — a skill in the home directory, a screenshot in `/tmp` — is
 * remembered but is not a way in.
 */
export function opensInWorkspace(path: string): boolean {
  return !path.startsWith('/') && !path.startsWith('../') && !/^[A-Za-z]:[\\/]/.test(path);
}

/**
 * The marker the goal extractor writes between the opening of the work and a
 * change of plan (`goalIn`, in `main/pi/extension/extract.ts`). It is a line of
 * the ledger like any other, so it reaches the window as text and is recognised
 * here by that text.
 */
const SCOPE_CHANGE = '[Scope change]';

/** What a person said in one turn about the work, as they wrote it. */
export interface Saying {
  at: string;
  lines: string[];
  /** Whether it came after the person changed their mind about the work. */
  isScopeChange: boolean;
}

/**
 * The goal as what was said rather than as the lines it was cut into.
 *
 * The ledger keeps one row per line so that a line is held once however often it
 * is read again, and the summary can pick among them. A person checking what
 * Kira was asked reads a message, not its lines, so lines that came from the same
 * turn — the same moment — are put back together. The scope-change marker is not
 * a saying: it says that everything after it is one, and is dropped here.
 */
export function sayingsIn(items: readonly ChatMemory[]): Saying[] {
  const sayings: Saying[] = [];
  let isScopeChange = false;

  for (const item of items) {
    if (item.text === SCOPE_CHANGE) {
      isScopeChange = true;
      continue;
    }

    const last = sayings.at(-1);
    if (last !== undefined && last.at === item.at && last.isScopeChange === isScopeChange) {
      last.lines.push(item.text);
    } else {
      sayings.push({ at: item.at, lines: [item.text], isScopeChange });
    }
  }

  return sayings;
}
