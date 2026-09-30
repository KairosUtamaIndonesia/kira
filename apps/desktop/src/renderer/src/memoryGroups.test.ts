import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ChatConclusion, ChatMemory, MemoryKind } from '../../preload/bridge.ts';
import {
  type GroupKind,
  commitParts,
  conclusionGroupIn,
  coverageLine,
  groupsIn,
  opensInWorkspace,
  pathParts,
  sayingsIn,
  skillParts,
} from './memoryGroups.ts';

const said = (kind: MemoryKind, text: string): ChatMemory => ({
  kind,
  at: '2026-01-01T00:00:00.000Z',
  text,
});

interface Case {
  name: string;
  memory: ChatMemory[];
  want: { kind: GroupKind; label: string; texts: string[] }[];
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
    name: 'a skill Kira loaded is told apart from the files she read, and sits below the work',
    // Loading a skill is reading its SKILL.md, which the ledger keeps as a read. A
    // skill is what shapes how Kira works, so it reads before any file does.
    memory: [
      said('read', 'deploy.toml'),
      said('read', '/home/a/.agents/skills/research/SKILL.md'),
      said('changed', 'src/a.ts'),
      said('goal', 'Fix the auth bug'),
      said('read', 'skills/SKILL.md.bak'),
    ],
    want: [
      { kind: 'goal', label: 'The work', texts: ['Fix the auth bug'] },
      { kind: 'skill', label: 'Skills', texts: ['/home/a/.agents/skills/research/SKILL.md'] },
      { kind: 'changed', label: 'Files changed', texts: ['src/a.ts'] },
      { kind: 'read', label: 'Files read', texts: ['deploy.toml', 'skills/SKILL.md.bak'] },
    ],
  },
  {
    name: 'a chat whose only reads were skills has no files-read heading',
    memory: [said('read', 'skills/to-spec/SKILL.md')],
    want: [{ kind: 'skill', label: 'Skills', texts: ['skills/to-spec/SKILL.md'] }],
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

interface PartsCase {
  name: string;
  path: string;
  want: { name: string; folder: string };
}

const PATH_CASES: PartsCase[] = [
  {
    name: 'a nested file leads with its name and keeps its folder',
    path: 'src/auth/session.ts',
    want: { name: 'session.ts', folder: 'src/auth' },
  },
  {
    name: 'a file at the root has no folder',
    path: 'deploy.toml',
    want: { name: 'deploy.toml', folder: '' },
  },
];

for (const testCase of PATH_CASES) {
  test(testCase.name, () => {
    assert.deepEqual(pathParts(testCase.path), testCase.want);
  });
}

interface CommitCase {
  name: string;
  text: string;
  want: { hash: string; subject: string };
}

const COMMIT_CASES: CommitCase[] = [
  {
    name: 'a commit is its hash and its subject',
    text: 'a1b2c3d: fix(auth): refresh the token',
    want: { hash: 'a1b2c3d', subject: 'fix(auth): refresh the token' },
  },
  {
    name: 'a line with no hash is all subject',
    text: 'fix the deploy',
    want: { hash: '', subject: 'fix the deploy' },
  },
];

for (const testCase of COMMIT_CASES) {
  test(testCase.name, () => {
    assert.deepEqual(commitParts(testCase.text), testCase.want);
  });
}

interface OpensCase {
  name: string;
  path: string;
  want: boolean;
}

const OPENS_CASES: OpensCase[] = [
  { name: 'a path inside the folder opens', path: 'src/auth/session.ts', want: true },
  { name: 'a file at the root opens', path: 'deploy.toml', want: true },
  { name: 'an absolute path is outside the folder', path: '/tmp/pomo-timer.png', want: false },
  { name: 'a path that climbs out is outside the folder', path: '../notes.md', want: false },
  {
    name: 'a Windows drive path is outside the folder',
    path: 'C:\\Users\\a\\notes.md',
    want: false,
  },
];

for (const testCase of OPENS_CASES) {
  test(testCase.name, () => {
    assert.equal(opensInWorkspace(testCase.path), testCase.want);
  });
}

const goalAt = (at: string, text: string): ChatMemory => ({ kind: 'goal', at, text });

interface SayingsCase {
  name: string;
  items: ChatMemory[];
  want: { lines: string[]; isScopeChange: boolean }[];
}

const SAYINGS_CASES: SayingsCase[] = [
  {
    name: 'lines from one turn are one saying',
    items: [
      goalAt('t1', 'Build a timer'),
      goalAt('t1', 'It is done when:'),
      goalAt('t1', 'It runs from a local file'),
    ],
    want: [
      {
        lines: ['Build a timer', 'It is done when:', 'It runs from a local file'],
        isScopeChange: false,
      },
    ],
  },
  {
    name: 'a change of plan is its own saying, and the marker is not shown',
    items: [
      goalAt('t1', 'Fix the auth bug'),
      goalAt('t1', '[Scope change]'),
      goalAt('t3', 'Switch to the refresh path instead'),
    ],
    want: [
      { lines: ['Fix the auth bug'], isScopeChange: false },
      { lines: ['Switch to the refresh path instead'], isScopeChange: true },
    ],
  },
  {
    name: 'a marker written a turn before the plan it announces still marks it',
    // The marker is held from the first turn a change was seen; the lines under it
    // may be from a later turn that replaced them.
    items: [
      goalAt('t1', 'Fix the auth bug'),
      goalAt('t2', '[Scope change]'),
      goalAt('t4', 'Add the refresh path'),
      goalAt('t4', 'And its tests'),
    ],
    want: [
      { lines: ['Fix the auth bug'], isScopeChange: false },
      { lines: ['Add the refresh path', 'And its tests'], isScopeChange: true },
    ],
  },
  {
    name: 'nothing said, nothing drawn',
    items: [],
    want: [],
  },
];

for (const testCase of SAYINGS_CASES) {
  test(testCase.name, () => {
    assert.deepEqual(
      sayingsIn(testCase.items).map(({ lines, isScopeChange }) => ({ lines, isScopeChange })),
      testCase.want,
    );
  });
}

interface SkillCase {
  name: string;
  path: string;
  want: { name: string; folder: string };
}

const SKILL_CASES: SkillCase[] = [
  {
    name: 'a skill is named by its folder and sourced by the folder above',
    path: '/home/brandon/.agents/skills/research/SKILL.md',
    want: { name: 'research', folder: '/home/brandon/.agents/skills' },
  },
  {
    name: 'a project skill is sourced inside the project',
    path: '.agents/skills/tdd/SKILL.md',
    want: { name: 'tdd', folder: '.agents/skills' },
  },
  {
    name: 'a skill at the top of the folder has no source',
    path: 'research/SKILL.md',
    want: { name: 'research', folder: '' },
  },
];

for (const testCase of SKILL_CASES) {
  test(testCase.name, () => {
    assert.deepEqual(skillParts(testCase.path), testCase.want);
  });
}
