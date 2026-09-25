import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { numberedIn, type StoredTurn } from './entries.ts';
import {
  paged,
  QUOTED,
  renderBody,
  renderFile,
  renderFound,
  renderFoundAcross,
  renderNoFile,
  renderNoPage,
  renderTurn,
  samePath,
  searchAcross,
  searchIn,
  turnAt,
  type Chat,
  type ToolResult,
} from './recall.ts';
import type { Part, Turn } from './turn.ts';

const person = (text: string): Turn => ({ speaker: 'person', text });
const kira = (text: string): Turn => ({ speaker: 'kira', text });
const tool = (text: string): Turn => ({ speaker: 'tool', text });

/** A chat as recall reads it, numbered by the function under test. */
function chat(...turns: Turn[]): StoredTurn[] {
  return turns.map((turn, index) => ({
    entryId: `e${index}`,
    at: `2026-01-01T00:00:0${index}.000Z`,
    turn,
  }));
}

// ── The number a turn is known by ────────────────────────────────────────────

test('turns are numbered from one, in the order they were said', () => {
  const numbered = numberedIn(
    chat(
      person('the config lives in deploy.toml'),
      kira('Reading it now.'),
      tool('fridays = 18:00'),
    ),
  );

  assert.deepEqual(
    numbered.map((each) => [each.number, each.entryId, each.turn.speaker]),
    [
      [1, 'e0', 'person'],
      [2, 'e1', 'kira'],
      [3, 'e2', 'tool'],
    ],
  );
});

test('a number is what a chat holds, so it does not move when later turns arrive', () => {
  // The whole reason a number is worth having instead of quoting text: a chat
  // goes on being written to, and what Kira was told at turn 2 has to stay
  // turn 2 — or every answer she gets back is about the wrong turn.
  const earlier = chat(person('the config lives in deploy.toml'), kira('Reading it now.'));
  const later = chat(
    person('the config lives in deploy.toml'),
    kira('Reading it now.'),
    person('and the rollback plan?'),
    kira('In docs/rollback.md.'),
  );

  const before = numberedIn(earlier).map((each) => [each.number, each.entryId]);
  const after = numberedIn(later)
    .slice(0, before.length)
    .map((each) => [each.number, each.entryId]);

  assert.deepEqual(after, before);
});

// ── Finding one ──────────────────────────────────────────────────────────────

const CHAT = numberedIn(
  chat(
    person('the config lives in deploy.toml'),
    kira('Reading it now.'),
    tool('fridays = "18:00"'),
  ),
);

test('a number finds the turn it stands for', () => {
  assert.deepEqual(turnAt(CHAT, 2)?.turn, kira('Reading it now.'));
});

test('a number the chat does not hold finds nothing', () => {
  // Zero, a negative, past the end and a fraction are all the same thing from
  // here: a number that is not a turn in this chat. Answering with the nearest
  // one would be worse than answering with nothing, because a wrong turn reads
  // exactly like a right one.
  for (const number of [0, -1, 4, 99, 1.5]) {
    assert.equal(turnAt(CHAT, number), null, `turn ${number} should not resolve`);
  }
});

// ── Searching the words ──────────────────────────────────────────────────────

interface SearchCase {
  name: string;
  words: string;
  cap?: number;
  want: { number: number; speaker: string; text: string }[];
}

const SEARCH_CASES: SearchCase[] = [
  {
    name: 'the turns whose words hold what was asked for',
    words: 'deploy',
    want: [{ number: 1, speaker: 'person', text: 'the config lives in deploy.toml' }],
  },
  {
    name: 'the turns whose words hold it, in the order they were said',
    // Only the first holds "the": the second says "it". Which is the point of
    // asserting the whole list — a search that also brought back its neighbours
    // would look identical in a test that only looked for the one it wanted.
    words: 'the',
    want: [{ number: 1, speaker: 'person', text: 'the config lives in deploy.toml' }],
  },
  {
    name: 'a search that does not care how it was capitalised',
    words: 'READING',
    want: [{ number: 2, speaker: 'kira', text: 'Reading it now.' }],
  },
  {
    name: 'a fraction of a word, because that is how a search is used',
    words: 'roll',
    want: [],
  },
  {
    name: 'nothing, from a chat that has not said it',
    words: 'kubernetes',
    want: [],
  },
  {
    name: 'nothing, from a search for nothing at all',
    // An empty search matches every turn, which is the one answer that is never
    // wanted: it is what a model sends by accident, and it fills the context.
    words: '',
    want: [],
  },
  {
    name: 'no more than it was allowed to bring back',
    // Recall exists to protect the context, so a question that matches the whole
    // chat must not return the whole chat.
    words: 'the',
    cap: 1,
    want: [{ number: 1, speaker: 'person', text: 'the config lives in deploy.toml' }],
  },
];

for (const testCase of SEARCH_CASES) {
  test(testCase.name, () => {
    assert.deepEqual(
      searchIn(CHAT, testCase.words, testCase.cap).map((found) => ({
        number: found.number,
        speaker: found.turn.speaker,
        text: found.turn.text,
      })),
      testCase.want,
    );
  });
}

test('a search for something every turn says brings back twenty and no more', () => {
  // The bound is the point of the tool, so it is pinned at a number rather than
  // against `FOUND` — a case that scaled its fixture with the cap would assert
  // nothing, because every cap would satisfy it. The chat is longer than the cap
  // on purpose: a bound tested at its own size is not tested.
  const many = numberedIn(
    Array.from({ length: 60 }, (_, index) => ({
      entryId: `e${index}`,
      at: `2026-01-01T00:00:00.000Z`,
      turn: person('the config lives in deploy.toml'),
    })),
  );

  assert.equal(searchIn(many, 'deploy').length, 20);
});

// ── Saying what was found ────────────────────────────────────────────────────

test('a quoted turn says who said it, when, and what', () => {
  assert.equal(
    renderTurn(turnAt(CHAT, 1) as never),
    '#1 (you, 2026-01-01T00:00:00.000Z):\nthe config lives in deploy.toml',
  );
});

test('a turn is quoted short enough to be worth asking for', () => {
  // A turn is whatever was said on it, and what was said can be a file someone
  // pasted in. Recall exists to save room in front of a model, so a lookup that
  // spent all of it would have cost more than it recovered.
  const pasted = numberedIn(chat(person('x'.repeat(20_000))));
  const quoted = renderTurn(pasted[0] as never);

  assert.ok(
    quoted.length < 3_000,
    `a quoted turn should be bounded, and this one was ${quoted.length} characters`,
  );
  assert.match(quoted, /more characters\]$/);
});

test('a search that found nothing says so, and quotes what it looked for', () => {
  assert.equal(
    renderFound(searchIn(CHAT, 'kubernetes'), 'kubernetes'),
    'This chat says nothing about "kubernetes".',
  );
});

test('a search says how many it found and quotes each one with its number', () => {
  assert.equal(
    renderFound(searchIn(CHAT, 'config'), 'config'),
    'Found 1 turn about "config":\n\n#1 (you): the config lives in deploy.toml',
  );
});

test('a full page of results is said to be a full page', () => {
  // A cap that is not announced reads as "that is all there is" rather than
  // "ask me differently", and a model has no way to tell the two apart.
  const many = numberedIn(
    Array.from({ length: 60 }, (_, index) => ({
      entryId: `e${index}`,
      at: `2026-01-01T00:00:00.000Z`,
      turn: person('the config lives in deploy.toml'),
    })),
  );
  const rendered = renderFound(searchIn(many, 'config'), 'config');

  assert.equal(rendered.split('\n').filter((line) => line.startsWith('#')).length, 20);
  assert.match(rendered, /That is as many as one search returns/);
});

// ── Reading a file again ─────────────────────────────────────────────────────

test('a path is compared as a file, not as a string someone typed', () => {
  const same: [string, string][] = [
    ['deploy.toml', 'deploy.toml'],
    ['"deploy.toml"', 'deploy.toml'],
    ['`deploy.toml`', 'deploy.toml'],
    ['./deploy.toml', 'deploy.toml'],
    ['deploy.toml:12', 'deploy.toml'],
    ['deploy.toml:12-40', 'deploy.toml'],
    ['deploy.toml#L12', 'deploy.toml'],
    ['/repo/src/a.ts', 'src/a.ts'],
    ['src/a.ts', '/repo/src/a.ts'],
  ];

  for (const [one, other] of same) {
    assert.equal(samePath(one, other), true, `${one} should be read as ${other}`);
  }

  const different: [string, string][] = [
    // The separator is what keeps a suffix match from reading one file's name
    // inside another's.
    ['beta.ts', 'a.ts'],
    ['src/a.ts', 'src/b.ts'],
    ['src/a.ts', 'other/src/a.ts.bak'],
    // Two files whose names share a tail after a separator are still two files.
    ['a/index.ts', 'b/index.ts'],
  ];

  for (const [one, other] of different) {
    assert.equal(samePath(one, other), false, `${one} should not be read as ${other}`);
  }
});

test('a long file is read a page at a time, and says how many pages there are', () => {
  const text = 'a'.repeat(QUOTED * 2 + 5);

  const first = paged(text, 1);
  assert.equal(first?.page, 1);
  assert.equal(first?.pages, 3);
  assert.equal(first?.text.length, QUOTED);

  const last = paged(text, 3);
  assert.equal(last?.page, 3);
  assert.equal(last?.text.length, 5);

  // Every page exactly once and in order: the pages are the text.
  const whole = [1, 2, 3].map((page) => paged(text, page)?.text ?? '').join('');
  assert.equal(whole, text);
});

test('a page the file does not have is refused rather than approximated', () => {
  const text = 'a'.repeat(QUOTED + 1);

  assert.equal(paged(text, 0), null);
  assert.equal(paged(text, 1.5), null);
  assert.equal(paged(text, 3), null);
});

test('a page ends where the units end, not where the characters end', () => {
  // Two CJK characters per page is eight units, so a page of CJK holds a quarter
  // of the characters a page of Latin does — the same bound, spent honestly.
  const cjk = paged('一'.repeat(QUOTED), 1);
  assert.equal(cjk?.text.length, QUOTED / 4);
});

test('one turn is read for the part that was asked for', () => {
  const turn = numberedIn(chat(person('the config lives in deploy.toml')))[0];
  assert.ok(turn);

  const parts: Part[] = [
    { kind: 'text', text: 'Reading it now.' },
    { kind: 'thinking', text: 'The deploy script reads deploy.toml.' },
    {
      kind: 'toolCall',
      callId: 'c1',
      name: 'read',
      text: '{\n  "path": "deploy.toml"\n}',
      path: 'deploy.toml',
    },
  ];

  assert.equal(
    renderBody(turn, parts, 'thinking'),
    '#1 (you, 2026-01-01T00:00:00.000Z) — thinking:\nThe deploy script reads deploy.toml.',
  );

  // A turn with none of what was asked for says what it does have, so a reader
  // can tell "wrong turn" from "wrong part".
  assert.equal(
    renderBody(turn, parts, 'toolResult'),
    'Turn 1 has no tool result in it. It has: text, thinking, tool call.',
  );
  assert.equal(renderBody(turn, [], 'text'), 'Turn 1 has nothing stored on it to read.');
});

test('a file read back says which page it is on, and where the rest is', () => {
  const turn = numberedIn(chat(person('the config lives in deploy.toml')))[0];
  assert.ok(turn);

  const result: ToolResult = {
    kind: 'toolResult',
    callId: 'c1',
    name: 'read',
    text: 'fridays = 18:00',
    failed: false,
  };

  assert.equal(
    renderFile(turn, 'deploy.toml', result, { text: 'fridays = 18:00', page: 1, pages: 1 }),
    '#1 (you, 2026-01-01T00:00:00.000Z) — deploy.toml, page 1 of 1:\nfridays = 18:00',
  );

  assert.equal(
    renderFile(turn, 'deploy.toml', result, { text: 'fridays', page: 1, pages: 2 }),
    '#1 (you, 2026-01-01T00:00:00.000Z) — deploy.toml, page 1 of 2:\nfridays\n\nPage 2 has the rest.',
  );

  // A read that failed holds an error message where contents are expected, and
  // showing it as contents would be showing an error as though it were the file.
  assert.equal(
    renderFile(
      turn,
      'deploy.toml',
      { ...result, failed: true, text: 'no such file' },
      {
        text: 'no such file',
        page: 1,
        pages: 1,
      },
    ),
    '#1 (you, 2026-01-01T00:00:00.000Z) — the read of deploy.toml failed:\nno such file',
  );
});

test('a file the turn never touched is answered with the files it did', () => {
  const turn = numberedIn(chat(person('the config lives in deploy.toml')))[0];
  assert.ok(turn);

  assert.equal(
    renderNoFile(turn, 'deploy.toml', ['src/a.ts', 'src/b.ts']),
    'Turn 1 did not touch deploy.toml. It touched: src/a.ts, src/b.ts.',
  );
  assert.equal(renderNoFile(turn, 'deploy.toml', []), 'Turn 1 touched no files.');
  assert.equal(renderNoPage('deploy.toml', 3, 9), 'deploy.toml has 3 pages; there is no page 9.');
  assert.equal(renderNoPage('deploy.toml', 1, 9), 'deploy.toml has 1 page; there is no page 9.');
});

// ── A search across a workspace ────────────────────────────────────────────────

/** A chat a workspace-scoped search reaches into: its name, or null for this one. */
const at = (name: string | null, ...turns: Turn[]): Chat => ({
  name,
  turns: numberedIn(chat(...turns)),
});

test('a search across a workspace names the chat each hit came from', () => {
  const found = searchAcross(
    [
      at(null, person('the rollback plan is in docs/rollback.md')),
      at('Ship it', kira('the rollback is documented in deploy.toml'), person('thanks')),
    ],
    'rollback',
  );

  assert.deepEqual(
    found.map((each) => [each.number, each.from, each.speaker, each.turn.text]),
    [
      [1, null, 'person', 'the rollback plan is in docs/rollback.md'],
      [1, 'Ship it', 'kira', 'the rollback is documented in deploy.toml'],
    ],
  );
});

test('a search across a workspace is capped across the workspace, not once per chat', () => {
  const twice = (word: string): Turn[] => [person(`${word} once`), person(`${word} twice`)];

  const found = searchAcross([at(null, ...twice('x')), at('Elsewhere', ...twice('x'))], 'x', 2);

  assert.deepEqual(
    found.map((each) => each.from),
    [null, null],
  );
});

test('a search across a workspace asked for nothing finds nothing', () => {
  const chats = [at(null, person('anything')), at('Elsewhere', kira('anything'))];

  assert.deepEqual(searchAcross(chats, '   '), []);
});

test('a workspace search that found nothing says so, and quotes what it looked for', () => {
  assert.equal(
    renderFoundAcross([], 'kubernetes'),
    'This workspace says nothing about "kubernetes".',
  );
});

test('a workspace search names each chat, and numbers only the turns of this one', () => {
  const found = searchAcross(
    [
      at(null, person('the rollback plan is in docs/rollback.md')),
      at('Ship it', kira('the rollback is documented in deploy.toml')),
    ],
    'rollback',
  );

  assert.equal(
    renderFoundAcross(found, 'rollback'),
    'Found 2 turns about "rollback", across this workspace:\n\n' +
      '#1 (you): the rollback plan is in docs/rollback.md\n' +
      '"Ship it" (kira): the rollback is documented in deploy.toml',
  );
});

test('a workspace search that fills up says there is more', () => {
  // Twenty-three turns of chatter and a cap of twenty: written as a literal so a
  // fixture that grew with the cap could not pass this by growing with it.
  const many = numberedIn(chat(...Array.from({ length: 23 }, () => person('x marks it'))));

  const found = searchAcross([{ name: null, turns: many }], 'x');

  assert.equal(found.length, 20);
  assert.ok(
    renderFoundAcross(found, 'x').endsWith('narrow it to see more.'),
    'a full page of results did not say there was more',
  );
});
