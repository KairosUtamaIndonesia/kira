import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  observationsIn,
  type Observation,
  type ObservationKind,
  type Relevance,
} from './memory.ts';
import type { StoredTurn } from './entries.ts';
import type { ToolUse, Turn } from './turn.ts';

const person = (text: string): Turn => ({ speaker: 'person', text });
const kira = (text: string, ...tools: ToolUse[]): Turn => ({ speaker: 'kira', text, tools });
const tool = (text: string): Turn => ({ speaker: 'tool', text });
const used = (name: string, path?: string): ToolUse => ({ name, path });

/** A chat as the observer reads it, stamped so each turn is told apart. */
function chat(...turns: Turn[]): StoredTurn[] {
  return turns.map((turn, index) => ({
    entryId: `e${index}`,
    at: `2026-01-01T00:00:0${index}.000Z`,
    turn,
  }));
}

const held = (
  entryId: string,
  index: number,
  kind: ObservationKind,
  relevance: Relevance,
  text: string,
): Observation => ({
  entryId,
  at: `2026-01-01T00:00:0${index}.000Z`,
  kind,
  relevance,
  text,
});

/**
 * Cases are named for the judgement they pin, and assert on the whole list
 * rather than a member of it: an observer that also holds something wrong is
 * wrong, and a test that only looks for what it expects cannot see that.
 */
interface Case {
  name: string;
  turns: Turn[];
  want: Observation[];
}

const CASES: Case[] = [
  {
    name: 'the opening message, as the goal of the work',
    turns: [person('Fix the auth bug in the login flow')],
    want: [held('e0', 0, 'goal', 'high', 'Fix the auth bug in the login flow')],
  },
  {
    name: 'a file Kira changed and one she only read, told apart',
    turns: [kira('', used('edit', 'src/auth/session.ts'), used('read', 'deploy.toml'))],
    want: [
      held('e0', 0, 'changed', 'medium', 'src/auth/session.ts'),
      held('e0', 0, 'read', 'low', 'deploy.toml'),
    ],
  },
  {
    name: 'a file she went on to change is not also one she only read',
    // The ledger is what Kira is holding now, not a log of every glance: one
    // file, held once, as the most she did to it — and standing at the entry
    // where she did that, not the one where she first opened it.
    turns: [
      kira('', used('read', 'src/auth/session.ts')),
      kira('', used('edit', 'src/auth/session.ts')),
    ],
    want: [held('e1', 1, 'changed', 'medium', 'src/auth/session.ts')],
  },
  {
    name: 'a file touched on turn after turn is held once, where it was first touched',
    turns: [
      kira('', used('edit', 'src/a.ts')),
      kira('', used('edit', 'src/a.ts')),
      kira('', used('edit', 'src/a.ts')),
    ],
    want: [held('e0', 0, 'changed', 'medium', 'src/a.ts')],
  },
  {
    name: 'a commit she made',
    turns: [tool('[main a1b2c3d] fix(auth): refresh the token after a reset')],
    want: [
      held('e0', 0, 'commit', 'medium', 'a1b2c3d: fix(auth): refresh the token after a reset'),
    ],
  },
  {
    name: 'a correction, which outranks the goal it was also a part of',
    // The same words are both the work and how it is to be done. Held as the
    // instruction, because repeating a rejected approach is the failure this
    // memory exists to prevent.
    turns: [person('Never push to main, always open a pull request')],
    want: [
      held('e0', 0, 'preference', 'critical', 'Never push to main, always open a pull request'),
    ],
  },
  {
    name: 'a later change of plan is kept as it happened, not only the last one',
    // The summary reports where the work stands. The ledger is the history of
    // how it got there, so a plan abandoned two turns ago is still something
    // Kira was told.
    turns: [
      person('Fix the auth bug in the login flow'),
      kira('Found it in session.ts.'),
      person('Actually, forget that, switch to the refresh path instead'),
      kira('Switching.'),
      person('Hmm, actually, let me see the deploy script instead'),
    ],
    want: [
      held('e0', 0, 'goal', 'high', 'Fix the auth bug in the login flow'),
      held('e2', 2, 'goal', 'high', '[Scope change]'),
      held('e2', 2, 'goal', 'high', 'Actually, forget that, switch to the refresh path instead'),
      held('e4', 4, 'goal', 'high', 'Hmm, actually, let me see the deploy script instead'),
    ],
  },
  {
    name: 'nothing at all, from a chat holding only a tool result and a reply',
    turns: [kira('It is in deploy.toml.'), tool('fridays = "18:00"')],
    want: [],
  },
  {
    name: 'nothing at all, from a chat where nothing was said',
    turns: [],
    want: [],
  },
];

for (const testCase of CASES) {
  test(testCase.name, () => {
    assert.deepEqual(observationsIn(chat(...testCase.turns)), testCase.want);
  });
}

test('a goal keeps the entry it was said in, not the newest one', () => {
  // The source is what lets what Kira holds be checked against what was said. An
  // observation that drifted to the latest entry every time the chat moved on
  // would name a turn that never said it — so the whole observation is asserted,
  // because a source and a timestamp can drift separately.
  assert.deepEqual(
    observationsIn(
      chat(
        person('Fix the auth bug in the login flow'),
        kira('Found it.'),
        person('Thanks, that works.'),
      ),
    ),
    [held('e0', 0, 'goal', 'high', 'Fix the auth bug in the login flow')],
  );
});

test('a file is named by where it is in the work, as the summary names it', () => {
  // Both readings of a chat have to agree: the ledger is what the summary is
  // selected from, and a ledger holding `/repo/src/a.ts` while the summary beside
  // it says `src/a.ts` would name the same file two ways to the same reader.
  assert.deepEqual(
    observationsIn(chat(kira('Reading.', used('read', '/repo/src/a.ts'))), '/repo'),
    [held('e0', 0, 'read', 'low', 'src/a.ts')],
  );
});
