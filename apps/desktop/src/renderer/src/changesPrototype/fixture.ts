/**
 * PROTOTYPE — throwaway. The question: what should the Changes view look like
 * in a 300–380px pane? Three variants of it, switchable from the floating bar.
 *
 * The data here is a stub on purpose. The variants are judged on a realistic
 * change set (staged, partly staged, unstaged, deleted, untracked, hunks, line
 * counts, history, ahead/behind), and staging, committing and reverting act on
 * this in-memory copy so nothing a person clicks reaches a real checkout.
 *
 * Two things here are not in the real status yet and would have to be added to
 * the main process if a variant that shows them wins: per-file line counts
 * (`git diff --numstat`) and ahead/behind (`git rev-list --left-right --count`).
 */
import { useState } from 'react';

export type FileStatus = 'M' | 'A' | 'D' | '?';

export interface Hunk {
  section: string;
  header: string;
  /** Lines with their `+`, `-` or space prefix. */
  lines: string[];
  staged: boolean;
}

export interface FixtureFile {
  path: string;
  status: FileStatus;
  /** The git header lines that open a file's patch. */
  head: string;
  hunks: Hunk[];
}

export interface FixtureCommit {
  short: string;
  subject: string;
  author: string;
  age: string;
}

export type FileState = 'staged' | 'partial' | 'unstaged';

type Spec = [oldStart: number, section: string, lines: string[]];

function file(path: string, status: FileStatus, specs: Spec[], staged = false): FixtureFile {
  const isNew = status === 'A' || status === '?';
  const isGone = status === 'D';
  const head = [
    `diff --git a/${path} b/${path}`,
    isNew ? 'new file mode 100644' : isGone ? 'deleted file mode 100644' : null,
    `index 3f2a1b0..9c4d7e2${isNew || isGone ? '' : ' 100644'}`,
    `--- ${isNew ? '/dev/null' : `a/${path}`}`,
    `+++ ${isGone ? '/dev/null' : `b/${path}`}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  let delta = 0;
  const hunks = specs.map(([oldStart, section, lines]): Hunk => {
    const oldCount = lines.filter((line) => !line.startsWith('+')).length;
    const newCount = lines.filter((line) => !line.startsWith('-')).length;
    const from = oldCount === 0 ? 0 : oldStart;
    const to = newCount === 0 ? 0 : oldStart + delta;
    delta += newCount - oldCount;

    return {
      section,
      header: `@@ -${from},${oldCount} +${to},${newCount} @@${section === '' ? '' : ` ${section}`}`,
      lines,
      staged,
    };
  });

  return { path, status, head, hunks };
}

function initialFiles(): FixtureFile[] {
  return [
    file(
      'apps/server/src/git.ts',
      'M',
      [
        [
          212,
          'async function githubLivePullRequests(',
          [
            '   owner: string,',
            '   name: string,',
            '-): Promise<LivePullRequest[] | null> {',
            "+  state: 'open' | 'closed' | 'all',",
            '+): Promise<LivePullRequest[] | null> {',
            '   const response = await githubRequest(',
            '     bearer,',
            '-    `${config.git.apiBaseUrl}/repos/${owner}/${name}/pulls?state=all&per_page=20`,',
            '+    `${config.git.apiBaseUrl}/repos/${owner}/${name}/pulls?state=${state}&per_page=30`,',
            '   );',
            '   if (response === null) return null;',
          ],
        ],
        [
          301,
          '.get(',
          [
            '           source.owner,',
            '           source.name,',
            "+          query.state ?? 'all',",
            '         );',
            '         if (pullRequests === null) {',
          ],
        ],
      ],
      true,
    ),
    file(
      'apps/server/src/gitState.test.ts',
      'A',
      [
        [
          0,
          '',
          [
            "+import { expect, test } from 'bun:test';",
            "+import { startFakeGitHub } from './test-support/fake-github';",
            '+',
            "+test('asks the host only for the state the filter names', async () => {",
            '+  const github = await startFakeGitHub({ id: 95, login: "acme" });',
            '+  try {',
            "+    expect(github.pullRequestStates).toEqual(['open']);",
            '+  } finally {',
            '+    await github.stop();',
            '+  }',
            '+});',
          ],
        ],
      ],
      true,
    ),
    file('apps/desktop/src/renderer/src/pullRequestsTab.tsx', 'M', [
      [
        28,
        'export function PullRequestsTab({',
        [
          '   const [selected, setSelected] = useState<number | null>(null);',
          '   const [detail, setDetail] = useState<LivePullRequestDetail | null>(null);',
          "+  const [state, setState] = useState<PullRequestState>('open');",
          "+  const [query, setQuery] = useState('');",
          '   const [tick, setTick] = useState(0);',
          '   const reading = useRef(0);',
        ],
      ],
      [
        194,
        '',
        [
          '   return (',
          '     <div {...stylex.props(styles.tab)}>',
          '-      {pullRequests.map((request) => (',
          '+      {visible.map((request) => (',
          '         <button',
          '           key={request.number}',
        ],
      ],
    ]),
    file('apps/desktop/src/renderer/src/pullRequestsModel.ts', 'M', [
      [
        9,
        '',
        [
          ' export function rowLabel(number: number, title: string): string {',
          '   return `#${number} ${title}`;',
          ' }',
          '+',
          '+export function visibleRequests(',
          '+  requests: readonly LivePullRequest[],',
          '+  query: string,',
          '+): LivePullRequest[] {',
          '+  const term = query.trim().toLowerCase();',
          '+  return term === "" ? [...requests] : requests.filter((request) => matches(request, term));',
          '+}',
        ],
      ],
    ]),
    file('apps/desktop/src/preload/bridge.ts', 'M', [
      [
        1004,
        '',
        [
          " /** A repository's pull request, read live from its Git host. */",
          ' export interface LivePullRequest {',
          '   number: number;',
          '   title: string;',
          '-  state: string;',
          '+  /** open, draft, merged or closed, as the host states it. */',
          '+  state: string;',
          '   url: string;',
        ],
      ],
    ]),
    file('CHANGELOG.md', 'M', [
      [
        6,
        '## [Unreleased]',
        [
          ' ### Added',
          ' ',
          '+- The Pull requests view filters by Open, Closed or All, and searches by number, title, author or branch.',
          ' - The workbench has a Changes view over the chat’s checkout.',
          ' ',
        ],
      ],
    ]),
    file('apps/desktop/src/renderer/src/subagentsPrototype.tsx', 'D', [
      [
        1,
        '',
        [
          '-/** A throwaway page for the sub-agent prompt. */',
          '-export function SubagentsPrototype() {',
          '-  return null;',
          '-}',
        ],
      ],
    ]),
    file('apps/desktop/src/renderer/src/pullRequestsFilter.tsx', '?', [
      [
        0,
        '',
        [
          "+import { Selector } from '@astryxdesign/core/Selector';",
          '+',
          '+export function StateFilter({ value, onChange }: Props) {',
          '+  return <Selector label="State" value={value} onChange={onChange} options={OPTIONS} />;',
          '+}',
        ],
      ],
    ]),
    file('docs/internal/notes.md', '?', [
      [0, '', ['+# Notes', '+', '+- Open is the default; All is one click away.']],
    ]),
  ];
}

const INITIAL_HISTORY: FixtureCommit[] = [
  {
    short: 'xqz',
    subject: 'refactor(desktop): use the Selector, not a native select',
    author: 'Brandon',
    age: '4m',
  },
  {
    short: 'zqr',
    subject: 'feat(desktop): filter pull requests by state and search them',
    author: 'Brandon',
    age: '31m',
  },
  {
    short: 'rkp',
    subject: 'perf(desktop): read a page of checks at once',
    author: 'Kira',
    age: '2h',
  },
  {
    short: 'ntp',
    subject: 'fix(server): hand the diff renderer a whole patch',
    author: 'Kira',
    age: '3h',
  },
  {
    short: 'qmu',
    subject: 'fix: read the checkout’s own repository’s pull requests',
    author: 'Kira',
    age: '1d',
  },
  { short: 'mut', subject: 'fix: serialise local git per repository', author: 'Kira', age: '1d' },
];

export const BRANCH = 'agent/changes-pr-views';

export function fileState(item: FixtureFile): FileState {
  const staged = item.hunks.filter((hunk) => hunk.staged).length;
  if (staged === 0) return 'unstaged';

  return staged === item.hunks.length ? 'staged' : 'partial';
}

/** An untracked file that is staged is an addition. */
export function statusOf(item: FixtureFile): FileStatus {
  return item.status === '?' && fileState(item) === 'staged' ? 'A' : item.status;
}

export function countsOf(item: FixtureFile): { added: number; removed: number } {
  const lines = item.hunks.flatMap((hunk) => hunk.lines);

  return {
    added: lines.filter((line) => line.startsWith('+')).length,
    removed: lines.filter((line) => line.startsWith('-')).length,
  };
}

/** What a hunk is called: the function git found it in, else the line it starts on. */
export function hunkLabel(hunk: Hunk): string {
  if (hunk.section !== '') return hunk.section;
  const start = /\+(\d+)/.exec(hunk.header)?.[1];

  return `Line ${start ?? 1}`;
}

export function hunkPatchOf(item: FixtureFile, at: number): string {
  const hunk = item.hunks[at]!;

  return `${item.head}\n${hunk.header}\n${hunk.lines.join('\n')}\n`;
}

export function patchOf(item: FixtureFile): string {
  const body = item.hunks.map((hunk) => `${hunk.header}\n${hunk.lines.join('\n')}`).join('\n');

  return `${item.head}\n${body}\n`;
}

export interface Fixture {
  files: FixtureFile[];
  /** Fully staged files. */
  staged: FixtureFile[];
  /** Tracked files not fully staged, partly staged ones included. */
  changes: FixtureFile[];
  untracked: FixtureFile[];
  history: FixtureCommit[];
  ahead: number;
  /** How many files a commit would hold: any file with a staged hunk. */
  committing: number;
  notice: string | null;
  toggleHunk(path: string, at: number): void;
  setFile(path: string, staged: boolean): void;
  setAll(staged: boolean): void;
  revert(path: string): void;
  commit(message: string): void;
  push(): void;
}

export function useFixture(): Fixture {
  const [files, setFiles] = useState<FixtureFile[]>(initialFiles);
  const [history, setHistory] = useState(INITIAL_HISTORY);
  const [ahead, setAhead] = useState(3);
  const [notice, setNotice] = useState<string | null>(null);

  function edit(path: string, change: (item: FixtureFile) => FixtureFile): void {
    setFiles((held) => held.map((item) => (item.path === path ? change(item) : item)));
  }

  return {
    files,
    staged: files.filter((item) => fileState(item) === 'staged'),
    changes: files.filter((item) => item.status !== '?' && fileState(item) !== 'staged'),
    untracked: files.filter((item) => item.status === '?' && fileState(item) !== 'staged'),
    history,
    ahead,
    committing: files.filter((item) => fileState(item) !== 'unstaged').length,
    notice,
    toggleHunk: (path, at) =>
      edit(path, (item) => ({
        ...item,
        hunks: item.hunks.map((hunk, index) =>
          index === at ? { ...hunk, staged: !hunk.staged } : hunk,
        ),
      })),
    setFile: (path, staged) =>
      edit(path, (item) => ({ ...item, hunks: item.hunks.map((hunk) => ({ ...hunk, staged })) })),
    setAll: (staged) =>
      setFiles((held) =>
        held.map((item) => ({ ...item, hunks: item.hunks.map((hunk) => ({ ...hunk, staged })) })),
      ),
    revert: (path) => {
      setFiles((held) => held.filter((item) => item.path !== path));
      setNotice('Reverted.');
    },
    commit: (message) => {
      setFiles((held) =>
        held
          .map((item) => ({ ...item, hunks: item.hunks.filter((hunk) => !hunk.staged) }))
          .filter((item) => item.hunks.length > 0),
      );
      setHistory((held) => [
        { short: 'new', subject: message.split('\n')[0] ?? message, author: 'Brandon', age: 'now' },
        ...held,
      ]);
      setAhead((held) => held + 1);
      setNotice('Committed.');
    },
    push: () => {
      setAhead(0);
      setNotice('Pushed.');
    },
  };
}
