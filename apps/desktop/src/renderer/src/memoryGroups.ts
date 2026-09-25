/**
 * The order and the words a person reads what Kira is holding in.
 *
 * Pure, so the pane that draws it has nothing to work out: what a group is
 * called and which comes first is a judgement about the memory rather than about
 * the drawing, and it is the part worth a test.
 */
import type { ChatConclusion, ChatMemory, MemoryKind } from '../../preload/bridge.ts';

/** What each kind is called where a person reads it. */
export const MEMORY_LABELS: Record<MemoryKind, string> = {
  preference: 'What you asked for',
  goal: 'The work',
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
const ORDER: Record<MemoryKind, number> = {
  preference: 0,
  goal: 1,
  changed: 2,
  commit: 3,
  read: 4,
};

/** One heading and what is under it. */
export interface MemoryGroup {
  kind: MemoryKind;
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
  const kinds = [...new Set(memory.map((each) => each.kind))].sort(
    (left, right) => ORDER[left] - ORDER[right],
  );

  return kinds.map((kind) => ({
    kind,
    label: MEMORY_LABELS[kind],
    items: memory.filter((each) => each.kind === kind),
  }));
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
