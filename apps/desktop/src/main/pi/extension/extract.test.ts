import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { commitsIn, filesIn, goalIn, preferencesIn } from './extract.ts';
import type { ToolUse, Turn } from './turn.ts';

const person = (text: string): Turn => ({ speaker: 'person', text });
const kira = (text: string, ...tools: ToolUse[]): Turn => ({ speaker: 'kira', text, tools });
const tool = (text: string): Turn => ({ speaker: 'tool', text });
const used = (name: string, path?: string): ToolUse => ({ name, path });

/**
 * Cases are named for the judgement they pin, and assert on the whole list
 * rather than a member of it: an extractor that also emits something wrong is
 * wrong, and a test that only looks for what it expects cannot see that.
 */
interface Case<T> {
  name: string;
  turns: Turn[];
  cwd?: string;
  want: T;
}

// ── The goal ─────────────────────────────────────────────────────────────────

const GOAL_CASES: Case<string[]>[] = [
  {
    name: 'the first thing asked',
    turns: [person('Fix the auth bug in the login flow')],
    want: ['Fix the auth bug in the login flow'],
  },
  {
    name: 'a bullet written as one',
    turns: [person('- Fix the auth bug\n- And the token refresh')],
    want: ['Fix the auth bug', 'And the token refresh'],
  },
  {
    name: 'a change of plan, kept as one rather than folded into the goal',
    // The chat was opened to fix auth; three hours later it is about the
    // refresh path. A summary that only ever reports the opening line sends
    // Kira back to work that was abandoned.
    turns: [
      person('Fix the auth bug in the login flow'),
      kira('Found it in session.ts.'),
      person('Actually, forget that, switch to the refresh path instead'),
    ],
    want: [
      'Fix the auth bug in the login flow',
      '[Scope change]',
      'Actually, forget that, switch to the refresh path instead',
    ],
  },
  {
    name: 'nothing at all, from a chat that has only been chatter',
    turns: [person('ok'), kira('Ready when you are.'), person('thanks')],
    want: [],
  },
  {
    name: 'nothing from a pasted machine, which is not something a person asked for',
    turns: [person('│ some pytest output\n└ done')],
    want: [],
  },
  {
    name: 'a goal written without spaces, as CJK is',
    // One line, no spaces and no sentence punctuation: nothing about it can be
    // found by splitting on words.
    turns: [person('修复登录流程中的认证错误')],
    want: ['修复登录流程中的认证错误'],
  },
  {
    name: 'work opened later without the person saying the plan had changed',
    // The other signal that the work moved on: a verb that opens something new,
    // in a line long enough to be an instruction. Nobody says "actually" every
    // time they ask for the next thing.
    turns: [
      person('Fix the auth bug in the login flow'),
      person('Implement the session refresh path properly'),
    ],
    want: [
      'Fix the auth bug in the login flow',
      '[Scope change]',
      'Implement the session refresh path properly',
    ],
  },
];

for (const testCase of GOAL_CASES) {
  test(`the goal is ${testCase.name}`, () => {
    assert.deepEqual(goalIn(testCase.turns), testCase.want);
  });
}

// ── Files and changes ────────────────────────────────────────────────────────

const FILE_CASES: Case<string[]>[] = [
  {
    name: 'found from the tools she reached for',
    turns: [
      kira('', used('write', 'src/auth/session.ts')),
      kira('', used('read', 'src/auth/login.ts')),
    ],
    want: ['src/auth/session.ts'],
  },
  {
    name: 'the same file altered and then read, which is not a file she read',
    turns: [
      kira('', used('read', 'src/auth/session.ts')),
      kira('', used('edit', 'src/auth/session.ts')),
    ],
    want: ['src/auth/session.ts'],
  },
];

for (const testCase of FILE_CASES) {
  test(`the changed files are ${testCase.name}`, () => {
    assert.deepEqual(filesIn(testCase.turns, testCase.cwd).changed, testCase.want);
  });
}

const READ_CASES: Case<string[]>[] = [
  {
    name: 'found from the tools she reached for',
    turns: [kira('', used('read', 'src/auth/login.ts'))],
    want: ['src/auth/login.ts'],
  },
  {
    name: 'a file altered from the same turn',
    turns: [kira('', used('read', 'a.ts'), used('write', 'a.ts'))],
    want: [],
  },
  {
    name: 'a file she only asked about, not one she touched',
    turns: [kira('', used('bash', 'rm -rf build'))],
    want: [],
  },
  {
    name: 'a tool that was aimed at no file at all',
    turns: [kira('', used('read'))],
    want: [],
  },
];

for (const testCase of READ_CASES) {
  test(`the read files are ${testCase.name}`, () => {
    assert.deepEqual(filesIn(testCase.turns, testCase.cwd).read, testCase.want);
  });
}

interface PathCase {
  name: string;
  arg: string;
  cwd?: string;
  want: string;
}

// The reference's path handling, which exists because tool arguments arrive as
// whatever the model typed: line suffixes from an editor, stray quotes, paths
// that reach out of the chat's folder. Left alone, `src/a.ts:10-40` and
// `/repo/src/a.ts` sit in the summary as two files, both phantom.
const PATH_CASES: PathCase[] = [
  { name: 'a path with a line range', arg: 'src/a.ts:10-40', want: 'src/a.ts' },
  { name: 'a path with one line', arg: 'src/a.ts:12', want: 'src/a.ts' },
  { name: 'a path with a hash line', arg: 'src/a.ts#L12', want: 'src/a.ts' },
  { name: 'a path in quotes, with a comma after it', arg: '"src/a.ts",', want: 'src/a.ts' },
  { name: 'a path in angle brackets, as a diff prints it', arg: '<src/a.ts>', want: 'src/a.ts' },
  {
    name: 'a path inside the chat folder, said in full',
    arg: '/repo/src/a.ts',
    cwd: '/repo',
    want: 'src/a.ts',
  },
  {
    name: 'a path out of the chat folder, which is the whole point of it',
    arg: '/tmp/scratch/a.ts',
    cwd: '/repo',
    want: '/tmp/scratch/a.ts',
  },
  {
    name: 'a path that climbs out and comes back',
    arg: 'src/../lib/a.ts',
    cwd: '/repo',
    want: 'lib/a.ts',
  },
  {
    name: 'a path named in CJK, which must survive being handled',
    arg: '文档/设计.md',
    cwd: '/repo',
    want: '文档/设计.md',
  },
  {
    name: 'a Windows path, whose drive letter must not read as a line number',
    arg: 'C:/repo/src/a.ts',
    want: 'C:/repo/src/a.ts',
  },
  {
    name: 'a folder whose own name has a colon in it',
    arg: 'notes:2026/a.ts',
    want: 'notes:2026/a.ts',
  },
];

for (const testCase of PATH_CASES) {
  test(`a file is found in ${testCase.name}`, () => {
    const turns = [kira('', used('write', testCase.arg))];

    assert.deepEqual(filesIn(turns, testCase.cwd).changed, [testCase.want]);
  });
}

// ── Commits ──────────────────────────────────────────────────────────────────

const COMMIT_CASES: Case<string[]>[] = [
  {
    name: 'a commit, read from what git printed',
    turns: [tool('[main a1b2c3d] fix(auth): refresh the token after a reset')],
    want: ['a1b2c3d: fix(auth): refresh the token after a reset'],
  },
  {
    name: 'a commit on a branch whose name has a slash in it',
    turns: [tool('[feature/session 9f8e7d6] add the refresh path')],
    want: ['9f8e7d6: add the refresh path'],
  },
  {
    name: 'a commit made alongside the rest of what git said',
    turns: [
      tool(
        'On branch main\nYour branch is up to date.\n\n[main a1b2c3d] fix(auth): refresh the token\n 1 file changed, 4 insertions(+)',
      ),
    ],
    want: ['a1b2c3d: fix(auth): refresh the token'],
  },
  {
    name: 'nothing, from a git command that only looked',
    turns: [tool('On branch main\nnothing to commit, working tree clean')],
    want: [],
  },
  {
    name: 'nothing, from a bare hash, which could be anything',
    // `a1b2c3d fix the thing` is what `git log --oneline` prints, and also
    // what a test runner, a package manager and a lockfile will print. Only
    // the bracketed form means a commit was made.
    turns: [tool('a1b2c3d fix the thing')],
    want: [],
  },
  {
    name: 'a commit made with no branch to name, as a detached head prints it',
    turns: [tool('[a1b2c3d] fix the auth bug')],
    want: ['a1b2c3d: fix the auth bug'],
  },
];

for (const testCase of COMMIT_CASES) {
  test(`the commits include ${testCase.name}`, () => {
    assert.deepEqual(commitsIn(testCase.turns), testCase.want);
  });
}

test('a commit made twice is carried once', () => {
  const made = tool('[main a1b2c3d] fix(auth): refresh the token');

  assert.deepEqual(commitsIn([made, made]), ['a1b2c3d: fix(auth): refresh the token']);
});

// ── What the person asked for ────────────────────────────────────────────────

const PREFERENCE_CASES: Case<string[]>[] = [
  {
    name: 'a standing instruction',
    turns: [person('Always run the tests before pushing')],
    want: ['Always run the tests before pushing'],
  },
  {
    name: 'a correction',
    turns: [person("That's wrong — stop using fetch in this file")],
    want: ["That's wrong — stop using fetch in this file"],
  },
  {
    name: 'a preference stated as one',
    turns: [person('I prefer tabs over spaces here')],
    want: ['I prefer tabs over spaces here'],
  },
  {
    name: 'a correction written in CJK, with no spaces in it',
    // Two characters and a complete directive. The floor below which a line is
    // too short to be an instruction is five for English and two for CJK, so
    // this case is here to fail if that floor ever becomes one number.
    turns: [person('回退')],
    want: ['回退'],
  },
  {
    name: 'a CJK instruction about what happens from now on',
    turns: [person('以后用 pnpm 安装依赖')],
    want: ['以后用 pnpm 安装依赖'],
  },
  {
    name: 'nothing from a question asking what she prefers',
    // "What do you prefer here?" contains a preference verb and is not a
    // preference. Only questions asking for information are dropped; a
    // directive phrased as a question ("Can you always run the tests?") stands.
    turns: [person('What do you prefer here?')],
    want: [],
  },
  {
    name: 'nothing from a CJK question that opens with a time scope',
    // 以后怎么提交代码？ leads with a standing-instruction marker and is still a
    // question. CJK fronts the time scope, so the interrogative is not first.
    turns: [person('以后怎么提交代码？')],
    want: [],
  },
  {
    name: 'nothing from ordinary talk',
    turns: [person('ok'), person('what does this function do?'), person('thanks!')],
    want: [],
  },
  {
    name: 'only the first thing asked in a long turn, not every line of a pasted list',
    turns: [person('Always run the tests\nNever push to main\nPlease use tabs')],
    want: ['Always run the tests'],
  },
];

for (const testCase of PREFERENCE_CASES) {
  test(`the preferences include ${testCase.name}`, () => {
    assert.deepEqual(preferencesIn(testCase.turns), testCase.want);
  });
}

test('the same preference asked for twice is carried once', () => {
  assert.deepEqual(
    preferencesIn([person('Always run the tests'), person('always run the tests')]),
    ['Always run the tests'],
  );
});
