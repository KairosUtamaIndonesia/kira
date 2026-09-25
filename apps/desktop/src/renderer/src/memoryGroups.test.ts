import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ChatConclusion, ChatMemory, MemoryKind } from '../../preload/bridge.ts';
import { conclusionGroupIn, coverageLine, groupsIn } from './memoryGroups.ts';

const said = (kind: MemoryKind, text: string): ChatMemory => ({
  kind,
  at: '2026-01-01T00:00:00.000Z',
  text,
});

interface Case {
  name: string;
  memory: ChatMemory[];
  want: { kind: MemoryKind; label: string; texts: string[] }[];
}

/**
 * Cases are named for the judgement they pin, and assert on the whole grouping
 * rather than a member of it: a pane that also shows the wrong thing under the
 * wrong heading is wrong, and a test that only looks for what it expects cannot
 * see that.
 */
const CASES: Case[] = [
  {
    name: 'what matters most reads first, whichever order it was said in',
    // The ledger is in the order the chat touched on things, which is the order
    // it happened in and not the order a person wants to check it. A file Kira
    // read at turn two outranks nothing.
    memory: [
      said('read', 'deploy.toml'),
      said('commit', 'a1b2c3d: fix the auth bug'),
      said('changed', 'src/auth/session.ts'),
      said('goal', 'Fix the auth bug in the login flow'),
      said('preference', 'Never push to main'),
    ],
    want: [
      { kind: 'preference', label: 'What you asked for', texts: ['Never push to main'] },
      { kind: 'goal', label: 'The work', texts: ['Fix the auth bug in the login flow'] },
      { kind: 'changed', label: 'Files changed', texts: ['src/auth/session.ts'] },
      { kind: 'commit', label: 'Commits', texts: ['a1b2c3d: fix the auth bug'] },
      { kind: 'read', label: 'Files read', texts: ['deploy.toml'] },
    ],
  },
  {
    name: 'things of one kind keep the order they were first said in',
    memory: [said('changed', 'src/a.ts'), said('changed', 'src/b.ts'), said('changed', 'src/c.ts')],
    want: [
      { kind: 'changed', label: 'Files changed', texts: ['src/a.ts', 'src/b.ts', 'src/c.ts'] },
    ],
  },
  {
    name: 'a kind Kira is holding nothing of gets no heading',
    // Not an empty section: a heading with nothing under it reads as work that
    // was lost rather than as work that was never done.
    memory: [said('goal', 'Fix the auth bug'), said('read', 'deploy.toml')],
    want: [
      { kind: 'goal', label: 'The work', texts: ['Fix the auth bug'] },
      { kind: 'read', label: 'Files read', texts: ['deploy.toml'] },
    ],
  },
  {
    name: 'nothing at all, from a chat that has not started',
    memory: [],
    want: [],
  },
];

for (const testCase of CASES) {
  test(testCase.name, () => {
    assert.deepEqual(
      groupsIn(testCase.memory).map((group) => ({
        kind: group.kind,
        label: group.label,
        texts: group.items.map((item) => item.text),
      })),
      testCase.want,
    );
  });
}

const concluded = (text: string, coversThrough: number | null): ChatConclusion => ({
  text,
  coversThrough,
});

interface ConclusionCase {
  name: string;
  conclusions: ChatConclusion[];
  want: { label: string; texts: string[] } | null;
}

/**
 * What a heading says and whether there is one at all are both judgements, and
 * the second is the one a pane gets wrong by drawing an empty section: it reads
 * as work that was lost rather than as work that was never done.
 */
const CONCLUSION_CASES: ConclusionCase[] = [
  {
    name: 'what Kira worked out reads as its own heading, in the order Kira worked it out',
    conclusions: [
      concluded('The bug is in the session lookup', 4),
      concluded('The queue was rejected for ingest', 9),
    ],
    want: {
      label: 'What Kira concluded',
      texts: ['The bug is in the session lookup', 'The queue was rejected for ingest'],
    },
  },
  {
    name: 'a chat that has worked nothing out gets no heading',
    conclusions: [],
    want: null,
  },
];

for (const testCase of CONCLUSION_CASES) {
  test(testCase.name, () => {
    const group = conclusionGroupIn(testCase.conclusions);

    assert.deepEqual(
      group === null ? null : { label: group.label, texts: group.items.map((item) => item.text) },
      testCase.want,
    );
  });
}

interface CoverageCase {
  name: string;
  coversThrough: number | null;
  want: string | null;
}

const COVERAGE_CASES: CoverageCase[] = [
  {
    name: 'how far it had read, as the turn number recall answers to',
    coversThrough: 12,
    want: 'Read through turn 12',
  },
  {
    name: 'nothing when it was never recorded',
    coversThrough: null,
    want: null,
  },
];

for (const testCase of COVERAGE_CASES) {
  test(testCase.name, () => {
    assert.equal(coverageLine(testCase.coversThrough), testCase.want);
  });
}
