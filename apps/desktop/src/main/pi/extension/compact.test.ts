import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BUDGET, lastWords, reconstruct } from './compact.ts';
import type { StoredTurn } from './entries.ts';
import type { Observation } from './memory.ts';
import type { Turn } from './turn.ts';

const person = (text: string): Turn => ({ speaker: 'person', text });
const kira = (text: string): Turn => ({ speaker: 'kira', text });
const tool = (text: string): Turn => ({ speaker: 'tool', text });
const worked = (text: string, name: string, path: string): Turn => ({
  speaker: 'kira',
  text,
  tools: [{ name, path }],
});

/** The same turns as a stored branch: each with the entry a chat keeps it in. */
const stored = (turns: readonly Turn[]): StoredTurn[] =>
  turns.map((turn, at) => ({ entryId: `e${at}`, at: '2026-01-01T00:00:00.000Z', turn }));

test('a chat is summarised as its goal, its files, its commits, what was asked for, and what was said', () => {
  // Asserted whole rather than by looking for what is expected in it: an
  // extractor that also emits something wrong is wrong, and this is the shape
  // the model is handed rather than an implementation detail.
  const chat: Turn[] = [
    person('Fix the auth bug in the login flow'),
    worked('Found it in session.ts.', 'edit', 'src/auth/session.ts'),
    tool('[main a1b2c3d] fix(auth): refresh the token after a reset'),
    person('Always run the tests before pushing'),
  ];

  const summary = reconstruct({ branch: stored(chat), discarded: chat, cwd: '/repo' });

  assert.equal(
    summary,
    `## Goal

- [1] Fix the auth bug in the login flow

## Files and changes

- Changed: [2] src/auth/session.ts

## Commits

- [3] a1b2c3d: fix(auth): refresh the token after a reset

## Preferences

- [4] Always run the tests before pushing

## Transcript

**person:** Fix the auth bug in the login flow

**kira:** Found it in session.ts.

**tool:** [main a1b2c3d] fix(auth): refresh the token after a reset

**person:** Always run the tests before pushing

A number in brackets names a turn of this chat: \`recall\` reads one back, or reads a file as the turn that touched it saw it.`,
  );
});

test('a section with nothing to say is left out rather than written empty', () => {
  // A chat that has only been chatter has no goal, no files, no commits and
  // nothing asked for. It should not carry four headings saying so.
  const chat: Turn[] = [person('ok'), kira('Ready when you are.')];

  const summary = reconstruct({ branch: stored(chat), discarded: chat });

  assert.equal(summary, '## Transcript\n\n**person:** ok\n\n**kira:** Ready when you are.');
});

test('an empty chat summarises to nothing at all', () => {
  assert.equal(reconstruct({ branch: [], discarded: [] }), '');
});

test('what is carried comes from the whole chat, not from the window being discarded', () => {
  // This is what the four sections are for. pi hands the hook the branch it is
  // compacting as well as the window, so the goal stated in the first message is
  // found again at the fifth compaction, long after that message left the window.
  // Reading the previous summary instead is what made what Kira knows decay.
  const opening: Turn[] = [
    person('Fix the auth bug in the login flow'),
    kira('Looking.'),
    tool('[main a1b2c3d] fix(auth): refresh the token'),
  ];
  const since: Turn[] = [person('and now the second half of it')];

  const summary = reconstruct({ branch: stored([...opening, ...since]), discarded: since });

  assert.ok(
    summary.includes('Fix the auth bug in the login flow'),
    `the goal was lost with the window:\n${summary}`,
  );
  assert.ok(
    summary.includes('a1b2c3d: fix(auth): refresh the token'),
    `the commit was lost with the window:\n${summary}`,
  );
  assert.ok(
    summary.includes('and now the second half of it'),
    `the window was not transcribed:\n${summary}`,
  );
  assert.ok(
    !summary.includes('Looking.'),
    `the transcript carried a turn it was not given:\n${summary}`,
  );
});

test('the same chat reads the same way twice', () => {
  const chat: Turn[] = [
    person('Fix the auth bug'),
    kira('Found it.'),
    tool('[main a1b2c3d] fix(auth): refresh the token'),
    person('Never push to main'),
  ];

  assert.equal(
    reconstruct({ branch: stored(chat), discarded: chat, cwd: '/repo' }),
    reconstruct({ branch: stored(chat), discarded: chat, cwd: '/repo' }),
  );
});

test('a chat compacted many times still knows what it was opened for', () => {
  // The property the four sections exist for, read at the level a person would
  // notice it: hours in, the reason the chat was opened is still in front of the
  // model. A summary built from the previous summary loses it around the third.
  let branch: Turn[] = [person('Fix the auth bug in the login flow')];
  let summary = '';

  for (let compaction = 0; compaction < 5; compaction += 1) {
    const since: Turn[] = [person(`and then part ${compaction} of it`)];
    branch = [...branch, ...since];
    summary = reconstruct({ branch: stored(branch), discarded: since });
  }

  assert.ok(summary.includes('Fix the auth bug in the login flow'), `the goal eroded:\n${summary}`);
  assert.ok(summary.includes('and then part 4 of it'), `the latest work was lost:\n${summary}`);
});

test('a chat too long to transcribe whole keeps its newest turns rather than its oldest', () => {
  const turns: Turn[] = Array.from({ length: 200 }, (_, n) =>
    person(`turn ${n} — ${'x'.repeat(300)}`),
  );

  const summary = reconstruct({ branch: stored(turns), discarded: turns });

  assert.ok(summary.includes('turn 199'), 'the newest turn was dropped');
  assert.ok(!summary.includes('turn 0 —'), 'the oldest turn was carried anyway');
});

test('a summary never runs past the budget, however long the chat was', () => {
  const turns: Turn[] = Array.from({ length: 500 }, (_, n) =>
    person(`turn ${n} — ${'x'.repeat(400)}`),
  );

  const summary = reconstruct({ branch: stored(turns), discarded: turns });

  assert.ok(summary.length <= BUDGET, `the summary ran to ${summary.length} characters`);
});

test('a summary never runs past the budget when every field it draws on is absurd', () => {
  // The files and the commits are the two whose length is whatever a tool
  // printed, so the whole is only bounded if those are bounded too. Every section
  // filled past its own limits is the case that says whether they are.
  const edits: Turn[] = Array.from({ length: 40 }, (_, n) => ({
    speaker: 'kira',
    text: 'x'.repeat(4_000),
    tools: [{ name: 'edit', path: `${'p'.repeat(400)}/file-${n}.ts` }],
  }));
  const commits: Turn[] = Array.from({ length: 20 }, (_, n) =>
    tool(`[main ${n.toString(16).padStart(7, '0')}] ${'s'.repeat(4_000)}`),
  );
  const asked: Turn[] = Array.from({ length: 40 }, (_, n) =>
    person(`Always run ${'q'.repeat(4_000)} ${n}`),
  );

  const summary = reconstruct({
    branch: stored([...edits, ...commits, ...asked]),
    discarded: edits,
  });

  assert.ok(summary.length <= BUDGET, `the summary ran to ${summary.length} characters`);
});

test('one pasted file does not spend the whole summary on itself', () => {
  const pasted = 'x'.repeat(200_000);

  const summary = reconstruct({ branch: stored([person(pasted)]), discarded: [person(pasted)] });

  assert.ok(
    summary.includes('[…199532 more characters]'),
    `the cut was not reported plainly:\n${summary.slice(-80)}`,
  );
  assert.ok(
    summary.length < BUDGET / 10,
    `one turn spent ${summary.length} characters of a ${BUDGET} budget`,
  );
});

test('a chat written in CJK does not get four times the room one in English does', () => {
  // The budget is counted in tokens, and CJK is about one token a character where
  // Latin is about a quarter of one. Counting characters would hand a CJK chat
  // four times the context of the English chat beside it, silently — which is what
  // this case exists to catch, so it compares the two rather than pinning either.
  const of = (line: (n: number) => string): string => {
    const turns: Turn[] = Array.from({ length: 2_000 }, (_, n) => person(line(n)));

    return reconstruct({ branch: stored(turns), discarded: turns });
  };

  const written = of((n) => `修复登录流程中的认证错误 ${n}`);
  const english = of((n) => `fix the auth bug in the login flow ${n}`);

  assert.ok(
    written.length < english.length / 2,
    `the CJK summary took ${written.length} characters to the English one's ${english.length}`,
  );
});

test('a turn with no words leaves no line behind', () => {
  const summary = reconstruct({
    branch: stored([person('keep me'), kira('   ')]),
    discarded: [person('keep me'), kira('   ')],
  });

  const lines = summary.split('\n').filter((line) => line.startsWith('**'));
  assert.deepEqual(lines, ['**person:** keep me'], `an empty turn was given a line:\n${summary}`);
});

interface LedeCase {
  name: string;
  turns: Turn[];
  /** What the boundary must lead with, or null when there is nothing to quote. */
  leads: string | null;
}

// What a boundary leads with, read from the turns rather than back out of the
// summary: a marker that led with the last thing *said* would quote Kira's
// answer, which says what she concluded rather than where the chat was cut.
const LEDE_CASES: LedeCase[] = [
  {
    name: 'the last thing the person asked, not the last thing said',
    turns: [
      person('the first thing I asked'),
      kira('Looking.'),
      person('the deployment runs on Fridays'),
      kira('Then the migration lands Thursday night.'),
    ],
    leads: 'the deployment runs on Fridays',
  },
  {
    name: 'nothing, when the person asked nothing',
    // A chat can be discarded into a summary with no question of its own in it —
    // a turn that only ran tools, or a first compaction cutting through Kira's
    // reply. The boundary then has a count to give and no words to quote.
    turns: [kira('Looking.'), tool('read deploy.toml')],
    leads: null,
  },
];

for (const testCase of LEDE_CASES) {
  test(`the boundary leads with ${testCase.name}`, () => {
    assert.equal(lastWords(testCase.turns), testCase.leads);
  });
}

test('a summary never runs past the budget when the workspace is holding as much as the chat', () => {
  // The sections are bounded by how many things they carry and how long one line
  // may be, so the case that says whether that arithmetic holds is both sources
  // filled at once: a chat's ledger as long as it is allowed to be and a workspace's
  // as long as it is allowed to be, every line clipped to its limit. A bound that
  // forgot either half, or forgot what its own cut-offs cost, is only visible here.
  const long = `/${'p'.repeat(400)}`;
  const turns: Turn[] = Array.from({ length: 58 }, (_each, at) => ({
    speaker: 'kira',
    text: 'x'.repeat(400),
    tools: [{ name: 'read', path: `${long}/file-${at}.ts` }],
  }));
  const decided: Observation[] = Array.from({ length: 40 }, (_each, at) => ({
    entryId: `elsewhere-${at}`,
    at: '2026-01-01T00:00:00.000Z',
    kind: 'preference',
    relevance: 'critical',
    text: `${long} ${at}`,
  }));

  const workedOut = Array.from({ length: 20 }, (_each, at) => ({
    id: at,
    text: `${'c'.repeat(400)} ${at}`,
    coversThrough: at,
  }));

  const summary = reconstruct({
    branch: stored(turns),
    discarded: turns,
    cwd: '/repo',
    elsewhere: decided,
    reflections: workedOut,
  });

  // Non-empty first: a test that a summary fits the budget passes just as well
  // when the summary is nothing at all.
  assert.ok(summary.includes('## Files and changes'), `no sections were built:\n${summary}`);
  assert.ok(summary.includes('## Decided in this workspace'), 'the workspace contributed nothing');
  assert.ok(summary.includes('## Transcript'), 'the transcript was squeezed out entirely');
  assert.ok(summary.length <= BUDGET, `the summary ran to ${summary.length} characters`);

  // And the arithmetic the budget rests on, written out rather than imported so
  // that moving any of the three numbers is a change this notices: 58 things from
  // this chat, 10 from the workspace and 10 conclusions, each line costing at most
  // the 200 units an item is allowed, plus the headings and the note. Everything here is ASCII, so
  // a character is a unit and the two are the same count.
  const sections = summary.split('## Transcript')[0] ?? '';
  assert.ok(sections.length <= 78 * 200 + 400, `the sections took ${sections.length} characters`);
});

test('a summary carries what the chat worked out, above the evidence for it', () => {
  const turns: Turn[] = [person('deploy the site'), kira('done, with scripts/ship.sh')];

  const summary = reconstruct({
    branch: stored(turns),
    discarded: turns,
    reflections: [
      {
        text: 'the deploy goes through scripts/ship.sh, which reads deploy.toml',
        coversThrough: 2,
      },
      { text: 'the person wants one commit per change', coversThrough: null },
    ],
  });

  // First, because a conclusion is what the evidence amounted to: everything under
  // it is there to support something, and this is the something.
  assert.ok(
    summary.indexOf('## Reflections') < summary.indexOf('## Goal'),
    `the conclusions came after the evidence:\n${summary}`,
  );
  assert.ok(
    summary.includes('- [2] the deploy goes through scripts/ship.sh, which reads deploy.toml'),
    summary,
  );
  assert.ok(summary.includes('- the person wants one commit per change'), summary);

  // A conclusion's turn number is a number in the summary like any other, so a
  // summary whose only handles are in its conclusions still says what they are.
  assert.ok(summary.includes('A number in brackets names a turn of this chat'), summary);
});

test('a summary whose chat has worked out nothing says nothing about conclusions', () => {
  const turns: Turn[] = [person('deploy the site')];

  const summary = reconstruct({ branch: stored(turns), discarded: turns });

  // A section with no lines is left out entirely: a summary that mentioned
  // conclusions it does not hold would teach the next window to expect a memory
  // that is not there.
  assert.ok(!summary.includes('## Reflections'), summary);

  // The goal is still numbered, so the note stays — the heading above is absent
  // and the explanation of what a number means is not, which is the difference
  // between saying nothing and saying something false.
  assert.ok(summary.includes('- [1] deploy the site'), summary);
});
