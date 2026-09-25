/**
 * What a summary carries, given more than it can hold.
 *
 * The cases are about the choices rather than the rendering: which things
 * survive when the ledger is larger than the summary, and what a thing is called
 * so that it can be read back.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { StoredReflection } from '../../db/threads.ts';
import type { HeldObservation, Observation, ObservationKind } from './memory.ts';
import { projectionIn } from './projection.ts';

/**
 * What each kind is worth, as the ledger records it.
 *
 * Spelled rather than imported, so that these cases are about what the selection
 * does with a relevance and not about which relevance a kind gets. That mapping
 * has its own test, in `memory.test.ts`.
 */
const RELEVANCE: Record<ObservationKind, Observation['relevance']> = {
  goal: 'high',
  changed: 'medium',
  commit: 'medium',
  read: 'low',
  preference: 'critical',
};

/** One thing Kira is holding, drawn from the turn named by `from`. */
const held = (kind: ObservationKind, text: string, from = text): HeldObservation => ({
  entryId: from,
  at: '2026-01-01T00:00:00.000Z',
  kind,
  relevance: RELEVANCE[kind],
  text,
});

/** A chat's worth of files read, as a chat that touched a lot would leave. */
const reads = (count: number): HeldObservation[] =>
  Array.from({ length: count }, (_each, at) => held('read', `src/file-${at}.ts`, `r${at}`));

/** A chat that changed its mind more often than a summary can report. */
const changes = (count: number): HeldObservation[] =>
  Array.from({ length: count }, (_each, at) => held('goal', `change ${at}`, `c${at}`));

/** The numbers a chat knows turns by, counting from one. */
const numbered = (...entryIds: readonly string[]): ReadonlyMap<string, number> =>
  new Map(entryIds.map((entryId, index) => [entryId, index + 1]));

test('what Kira is holding is grouped the way the summary says it, and names its turn', () => {
  const projection = projectionIn(
    [
      held('goal', 'deploy the site', 'a'),
      held('read', 'scripts/ship.sh', 'b'),
      held('preference', 'always run the tests', 'c'),
      held('commit', 'a1b2c3d: fix the deploy', 'd'),
      held('changed', 'deploy.toml', 'e'),
    ],
    numbered('a', 'b', 'c', 'd', 'e'),
  );

  assert.deepEqual(projection, {
    goal: ['[1] deploy the site'],
    changed: ['[5] deploy.toml'],
    read: ['[2] scripts/ship.sh'],
    commit: ['[4] a1b2c3d: fix the deploy'],
    preference: ['[3] always run the tests'],
    elsewhere: [],
    reflections: [],
  });
});

test('things keep the order the chat first touched them, so a plan reads as a story', () => {
  const projection = projectionIn(
    [
      held('goal', 'deploy the site', 'a'),
      held('goal', '[Scope change]', 'b'),
      held('goal', 'deploy it with rsync instead', 'b'),
    ],
    numbered('a', 'b'),
  );

  assert.deepEqual(projection.goal, [
    '[1] deploy the site',
    '[2] [Scope change]',
    '[2] deploy it with rsync instead',
  ]);
});

test('a correction outlives a file read after it, because what matters is what it is', () => {
  const ledger = [held('preference', 'never push on a Friday', 'p'), ...reads(60)];

  const projection = projectionIn(ledger, numbered(...ledger.map((each) => each.entryId)));

  assert.deepEqual(projection.preference, ['[1] never push on a Friday']);
  // Not 58 reads: a correction is worth more than any number of them, so it is
  // the reading that gives way. 58 is what a summary carries, written out rather
  // than asked for, so that changing it is a change this test can notice.
  assert.equal(projection.read.length, 57);
  assert.ok(projection.read.includes('[61] src/file-59.ts'), 'the newest read was dropped');
  assert.ok(!projection.read.includes('[2] src/file-0.ts'), 'the oldest read was kept');
});

test('the opening goal is kept even when the chat is holding more than fits', () => {
  // Every one of these is worth as much as the opening, so the only thing that
  // could have saved it is the rule that does.
  const ledger = [held('goal', 'deploy the site', 'g0'), ...changes(60)];

  const projection = projectionIn(ledger, numbered(...ledger.map((each) => each.entryId)));

  assert.equal(projection.goal.length, 58);
  assert.ok(projection.goal.includes('[1] deploy the site'), 'the opening was dropped');
  assert.ok(!projection.goal.includes('[2] change 0'), 'the oldest change was kept');
});

test('a chat that is holding nothing has nothing to carry', () => {
  assert.deepEqual(projectionIn([], numbered()), {
    goal: [],
    changed: [],
    read: [],
    commit: [],
    preference: [],
    elsewhere: [],
    reflections: [],
  });
});

test('a workspace contributes fewer things than the chat does, and its newest first', () => {
  const decisions = (count: number): Observation[] =>
    Array.from({ length: count }, (_each, at) =>
      held('preference', `decision ${at}`, `elsewhere-${at}`),
    );

  const projection = projectionIn([], numbered(), decisions(30));

  // Literal, so that changing the number is a change this notices. A workspace's
  // chats are other people's afternoons: carrying as much of them as of the
  // chat's own work would let a sibling's history push this chat's out.
  assert.equal(projection.elsewhere.length, 10);
  assert.ok(
    projection.elsewhere.includes('Preference: decision 29'),
    'the newest decision was dropped',
  );
  assert.ok(
    !projection.elsewhere.includes('Preference: decision 0'),
    'the oldest decision was kept',
  );
});

test('what another chat decided is carried, and told apart from what it merely read', () => {
  // Real ledgers are mostly files somebody read, and a workspace's chats read a
  // great many between them. Carried without being named, under a heading about
  // decisions, they read as decisions — so what each thing is gets said, and a
  // reading is left out of a section that is about what was decided.
  const projection = projectionIn([held('goal', 'deploy the site', 'a')], numbered('a'), [
    held('preference', 'the queue was rejected for ingest', 'elsewhere-1'),
    held('goal', 'what is this workspace', 'elsewhere-2'),
    held('read', 'package.json', 'elsewhere-3'),
  ]);

  assert.deepEqual(projection.elsewhere, [
    'Preference: the queue was rejected for ingest',
    'Goal: what is this workspace',
  ]);
});

/** One thing the chat worked out. */
function concluded(text: string, coversThrough: number | null): StoredReflection {
  return { id: 0, text, coversThrough };
}

test('what a chat worked out is carried, and named by the turn it was drawn up to', () => {
  const projection = projectionIn(
    [held('goal', 'deploy the site', 'a')],
    numbered('a'),
    [],
    [
      concluded('the deploy goes through scripts/ship.sh', 1),
      concluded('the person wants short answers', null),
    ],
  );

  // The turn is a handle the reader can go back with, so a conclusion can be
  // checked against the evidence rather than believed. A conclusion drawn before
  // anything was numbered has no handle, and is carried without one.
  assert.deepEqual(projection.reflections, [
    '[1] the deploy goes through scripts/ship.sh',
    'the person wants short answers',
  ]);
});

test('a chat that has worked out more than fits carries the newest of it', () => {
  const worked = Array.from({ length: 12 }, (_each, at) => concluded(`conclusion ${at}`, at));

  const projection = projectionIn([], new Map(), [], worked);

  // Conclusions accumulate and are never replaced, so the ones carried are chosen
  // by recency — and once chosen they are read in the order they were drawn in, so
  // a chain of conclusions still reads as a chain. Ten is the cap, written here as
  // a literal: a test that asked the module how many it carries would pass after
  // that number changed.
  assert.equal(projection.reflections.length, 10);
  assert.equal(projection.reflections[0], '[2] conclusion 2');
  assert.equal(projection.reflections[9], '[11] conclusion 11');
});

test('a chat that has worked out nothing carries nothing', () => {
  assert.deepEqual(projectionIn([], new Map()).reflections, []);
});
