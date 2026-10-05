import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { devNull } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  applyPatchToIndex,
  branchesOf,
  changedByGit,
  cloneInto,
  cloneUrl,
  commitFilesOf,
  commitStaged,
  hasRemote,
  isolatedCheckout,
  insideFolder,
  listedByGit,
  logOf,
  parseRemote,
  patchOf,
  providerOf,
  remoteOf,
  revertPath,
  splitListing,
  stagePaths,
  statusOf,
  switchBranch,
  syncRemote,
  unstagePaths,
} from './git.ts';
import { tempDir } from '../test-support/temp.ts';
import { listFolder } from './listing.ts';

interface Case {
  name: string;
  output: string;
  want: string[];
}

/**
 * git answers a `-z` listing with the paths themselves, NUL-separated, and the
 * separator after the last one is the thing this has to get right: read as a
 * path, it becomes an entry with no name.
 */
const CASES: Case[] = [
  { name: 'nothing named is nothing', output: '', want: [] },
  { name: 'one path, and the separator after it', output: 'a.ts\0', want: ['a.ts'] },
  { name: 'several paths', output: 'a.ts\0src/b.ts\0', want: ['a.ts', 'src/b.ts'] },
  {
    name: 'a path holding a newline is one path',
    output: 'odd\nname.ts\0b.ts\0',
    want: ['odd\nname.ts', 'b.ts'],
  },
];

for (const testCase of CASES) {
  test(testCase.name, () => {
    assert.deepEqual(splitListing(testCase.output), testCase.want);
  });
}

interface PrefixCase {
  name: string;
  paths: string[];
  prefix: string;
  want: string[];
}

/**
 * git answers a status query with paths from the repository root however it was
 * asked, so the folder's own prefix comes off each one. `-- .` already keeps the
 * answer to the folder, and a path from outside it is still not marked: what
 * comes back is the folder's own paths or it is nothing.
 */
const PREFIX_CASES: PrefixCase[] = [
  {
    name: 'a folder at the root of its checkout has no prefix to take off',
    paths: ['a.ts', 'src/b.ts'],
    prefix: '',
    want: ['a.ts', 'src/b.ts'],
  },
  {
    name: 'a folder inside one has its own path taken off every answer',
    paths: ['apps/desktop/a.ts', 'apps/desktop/src/b.ts'],
    prefix: 'apps/desktop/',
    want: ['a.ts', 'src/b.ts'],
  },
  {
    name: 'a path from outside the folder is not one of its own',
    paths: ['apps/desktop/a.ts', 'apps/server/b.ts'],
    prefix: 'apps/desktop/',
    want: ['a.ts'],
  },
  { name: 'nothing reported is nothing changed', paths: [], prefix: 'src/', want: [] },
];

for (const testCase of PREFIX_CASES) {
  test(testCase.name, () => {
    assert.deepEqual(insideFolder(testCase.paths, testCase.prefix), testCase.want);
  });
}

/** Whether git can be run here at all, which is what the real-git tests need. */
function gitRuns(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * A git configuration of this test's own.
 *
 * Whose machine this runs on must not change the answer: an operator's global
 * excludes would otherwise hide files this expects to see, and the excludes file
 * this points at is what the global-excludes case below is about — git reads it
 * because the query passes `--exclude-standard`, and a filter we wrote ourselves
 * would not.
 */
function isolatedGit(): void {
  const home = tempDir('kira-git-home-');

  writeFileSync(join(home, 'ignore'), '*.globalignore\n');
  writeFileSync(join(home, 'gitconfig'), `[core]\n\texcludesFile = ${join(home, 'ignore')}\n`);
  process.env['GIT_CONFIG_GLOBAL'] = join(home, 'gitconfig');
  process.env['GIT_CONFIG_SYSTEM'] = devNull;
}

/**
 * A checkout to ask, written out rather than recorded: a fake would check
 * neither the flags nor the running of git, and a wrong flag comes back as a
 * plausible list that is merely missing files — which is exactly the failure
 * this cannot afford to have quietly.
 *
 * Two levels of ignore file and a negation, so the answer has to be git's own
 * semantics rather than a pattern match of ours: `*.env` hides `src/secret.env`,
 * and `!keep.env` in the folder below brings `src/deep/keep.env` back. The
 * directory-only `node_modules/` hides everything under it, and
 * `src/notes.globalignore` is hidden by the excludes file above and not by
 * anything in this checkout.
 */
function writtenCheckout(): string {
  const root = tempDir('kira-checkout-');

  execFileSync('git', ['-C', root, 'init'], { stdio: 'ignore' });
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n*.env\n');
  mkdirSync(join(root, 'src', 'deep'), { recursive: true });
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'src', 'keep.ts'), '');
  writeFileSync(join(root, 'src', 'secret.env'), '');
  writeFileSync(join(root, 'src', 'notes.globalignore'), '');
  writeFileSync(join(root, 'src', 'deep', '.gitignore'), '!keep.env\n');
  writeFileSync(join(root, 'src', 'deep', 'keep.env'), '');
  writeFileSync(join(root, 'src', 'deep', 'a.txt'), '');
  writeFileSync(join(root, 'node_modules', 'junk.js'), '');

  return root;
}

test('the listing is the files git does not hide, and the folder draws them', async (t) => {
  if (!gitRuns()) {
    t.skip('no git can be run here — a machine without one is ADR 0014’s revisit condition');
    return;
  }

  isolatedGit();

  const root = writtenCheckout();

  // git's own order is not part of the answer, so both sides are sorted: what
  // is being checked is which files are in it, not the order git chose.
  assert.deepEqual((await listedByGit(root))?.sort(), [
    '.gitignore',
    'src/deep/.gitignore',
    'src/deep/a.txt',
    'src/deep/keep.env',
    'src/keep.ts',
  ]);

  // The tree's own view of the same folder: the ignored directory is not a row,
  // and neither is the ignored file beside a kept one.
  assert.deepEqual(await listFolder(root, ''), {
    entries: [
      { name: 'src', path: 'src', kind: 'folder' },
      { name: '.gitignore', path: '.gitignore', kind: 'file' },
    ],
    filtered: true,
    // Nothing here has ever been committed, so git reports all of it as new —
    // and the marks come back named the way the rows are, from the root.
    changed: [
      '.gitignore',
      'src/deep/.gitignore',
      'src/deep/a.txt',
      'src/deep/keep.env',
      'src/keep.ts',
    ],
  });

  // Asked for one folder lower down, the answer is that folder's own contents,
  // which is what makes the walk a level at a time.
  assert.deepEqual(await listFolder(root, 'src'), {
    entries: [
      { name: 'deep', path: 'src/deep', kind: 'folder' },
      { name: 'keep.ts', path: 'src/keep.ts', kind: 'file' },
    ],
    filtered: true,
    changed: ['src/deep/.gitignore', 'src/deep/a.txt', 'src/deep/keep.env', 'src/keep.ts'],
  });
});

/**
 * The same checkout with everything in it committed, so that a change is a
 * change rather than a file git has never seen.
 */
function committedCheckout(): string {
  const root = writtenCheckout();

  execFileSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' });
  execFileSync(
    'git',
    [
      '-C',
      root,
      '-c',
      'user.email=kira@test',
      '-c',
      'user.name=Kira',
      'commit',
      '-m',
      'the state this was written in',
    ],
    { stdio: 'ignore' },
  );

  return root;
}

test('what git reports as changed is joined to the folder it is asked about', async (t) => {
  if (!gitRuns()) {
    t.skip('no git can be run here — a machine without one is ADR 0014’s revisit condition');
    return;
  }

  isolatedGit();

  const root = committedCheckout();

  // Nothing has been touched since it was committed, so nothing is marked.
  assert.deepEqual(await changedByGit(root), []);

  writeFileSync(join(root, 'src', 'keep.ts'), 'changed\n');
  writeFileSync(join(root, 'src', 'added.ts'), 'new\n');
  writeFileSync(join(root, 'top.ts'), 'touched\n');

  // From the workspace root: all three, named from it.
  assert.deepEqual(await changedByGit(root), ['src/added.ts', 'src/keep.ts', 'top.ts']);

  // From a folder inside it: the same files named from that folder, and nothing
  // from outside it. git answers with paths from the repository root however it
  // is asked, so this is that prefix coming off — and a workspace that is a
  // folder inside a larger checkout is exactly this case.
  assert.deepEqual(await changedByGit(join(root, 'src')), ['added.ts', 'keep.ts']);

  // Put back the way it was committed, and it is not changed any more.
  writeFileSync(join(root, 'src', 'keep.ts'), '');
  assert.deepEqual(await changedByGit(join(root, 'src')), ['added.ts']);
});

test('a write-capable child checkout has the parent snapshot without sharing later writes', async (t) => {
  if (!gitRuns()) {
    t.skip('git is required to create an isolated checkout');
    return;
  }
  const root = committedCheckout();
  writeFileSync(join(root, 'src', 'keep.ts'), 'parent edit\n');
  writeFileSync(join(root, 'src', 'new.ts'), 'untracked\n');

  const child = await isolatedCheckout(join(root, 'src'));
  assert.equal(readFileSync(join(child, 'keep.ts'), 'utf8'), 'parent edit\n');
  assert.equal(readFileSync(join(child, 'new.ts'), 'utf8'), 'untracked\n');
  writeFileSync(join(child, 'keep.ts'), 'child edit\n');
  assert.equal(readFileSync(join(root, 'src', 'keep.ts'), 'utf8'), 'parent edit\n');
});

test('a folder that is not a checkout is null, which is git saying nothing', async (t) => {
  if (!gitRuns()) {
    t.skip('no git can be run here — a machine without one is ADR 0014’s revisit condition');
    return;
  }

  const folder = tempDir('kira-not-a-checkout-');

  assert.equal(await listedByGit(folder), null);
  assert.equal(await changedByGit(folder), null);
});

test(
  'hasRemote distinguishes a checkout with a remote from one without',
  { skip: !gitRuns() },
  async () => {
    const root = tempDir('kira-remotes-');
    execFileSync('git', ['-C', root, 'init'], { stdio: 'ignore' });

    assert.equal(await hasRemote(root), false);

    execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://example.test/kira.git'], {
      stdio: 'ignore',
    });
    assert.equal(await hasRemote(root), true);
    assert.equal(await hasRemote(tempDir('kira-not-a-checkout-')), null);
  },
);

test(
  'branchesOf names a local branches of a checkout and the one it has out',
  { skip: !gitRuns() },
  async () => {
    isolatedGit();
    const root = tempDir('kira-branches-');
    const git = (...args: string[]): void => {
      execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
    };
    git('init', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'first');
    git('branch', 'develop');

    const answer = await branchesOf(root);
    assert.deepEqual([...answer.branches].sort(), ['develop', 'main']);
    assert.equal(answer.current, 'main');
  },
);

test('branchesOf refuses a folder that is not a checkout', { skip: !gitRuns() }, async () => {
  isolatedGit();
  await assert.rejects(branchesOf(tempDir('kira-not-a-checkout-')));
});

interface RemoteCase {
  name: string;
  url: string;
  want: { host: string; owner: string; name: string } | null;
}

/**
 * What a checkout's remote says about which repository it is. git writes a URL
 * in several shapes for the same repository, and the folder is the only thing
 * that knows — so all of them have to read the same way, and anything that names
 * no repository has to read as nothing rather than as a guess.
 */
const REMOTE_CASES: RemoteCase[] = [
  {
    name: 'an https remote, with the .git git writes',
    url: 'https://github.com/KairosUtamaIndonesia/kira.git',
    want: { host: 'github.com', owner: 'KairosUtamaIndonesia', name: 'kira' },
  },
  {
    name: 'an https remote without it',
    url: 'https://github.com/KairosUtamaIndonesia/kira',
    want: { host: 'github.com', owner: 'KairosUtamaIndonesia', name: 'kira' },
  },
  {
    name: 'the scp form git clones with, which is not a URL and does not parse as one',
    url: 'git@github.com:KairosUtamaIndonesia/kira.git',
    want: { host: 'github.com', owner: 'KairosUtamaIndonesia', name: 'kira' },
  },
  {
    name: 'the ssh:// form',
    url: 'ssh://git@github.com/KairosUtamaIndonesia/kira.git',
    want: { host: 'github.com', owner: 'KairosUtamaIndonesia', name: 'kira' },
  },
  {
    name: 'a remote carrying credentials',
    url: 'https://user:token@github.com/KairosUtamaIndonesia/kira.git',
    want: { host: 'github.com', owner: 'KairosUtamaIndonesia', name: 'kira' },
  },
  {
    name: 'a host that is named in another case',
    url: 'https://GitHub.com/KairosUtamaIndonesia/kira.git',
    want: { host: 'github.com', owner: 'KairosUtamaIndonesia', name: 'kira' },
  },
  {
    name: 'a nested group, read owner-first the way the GitLab adapter reads it',
    url: 'https://gitlab.com/group/subgroup/project.git',
    want: { host: 'gitlab.com', owner: 'group', name: 'subgroup/project' },
  },
  { name: 'a path that names no repository', url: 'https://github.com/onlyone', want: null },
  { name: 'nothing at all', url: '', want: null },
  { name: 'something that is neither form', url: 'not a remote', want: null },
];

for (const testCase of REMOTE_CASES) {
  test(`parseRemote reads ${testCase.name}`, () => {
    assert.deepEqual(parseRemote(testCase.url), testCase.want);
  });
}

test('providerOf names the hosts Kira can watch by itself, and nothing else', () => {
  assert.equal(providerOf('github.com'), 'github');
  assert.equal(providerOf('gitlab.com'), 'gitlab');
  assert.equal(providerOf('git.acme.dev'), null);
});

test('remoteOf reads the origin a checkout was cloned from', { skip: !gitRuns() }, async () => {
  const root = tempDir('kira-remote-');
  execFileSync('git', ['-C', root, 'init'], { stdio: 'ignore' });
  execFileSync(
    'git',
    ['-C', root, 'remote', 'add', 'origin', 'git@github.com:KairosUtamaIndonesia/kira.git'],
    { stdio: 'ignore' },
  );

  assert.deepEqual(await remoteOf(root), {
    host: 'github.com',
    owner: 'KairosUtamaIndonesia',
    name: 'kira',
    provider: 'github',
  });
});

test(
  'remoteOf answers nothing for no remote, no checkout, or an unreadable URL',
  { skip: !gitRuns() },
  async () => {
    const bare = tempDir('kira-no-remote-');
    execFileSync('git', ['-C', bare, 'init'], { stdio: 'ignore' });

    const odd = tempDir('kira-odd-remote-');
    execFileSync('git', ['-C', odd, 'init'], { stdio: 'ignore' });
    execFileSync('git', ['-C', odd, 'remote', 'add', 'origin', 'not a remote'], {
      stdio: 'ignore',
    });

    assert.equal(await remoteOf(bare), null);
    assert.equal(await remoteOf(odd), null);
    assert.equal(await remoteOf(tempDir('kira-not-a-checkout-')), null);
  },
);

test(
  'remoteOf keeps a repository on a host Kira does not name, so the person can be asked',
  { skip: !gitRuns() },
  async () => {
    const root = tempDir('kira-other-host-');
    execFileSync('git', ['-C', root, 'init'], { stdio: 'ignore' });
    execFileSync(
      'git',
      ['-C', root, 'remote', 'add', 'origin', 'https://git.acme.dev/team/api.git'],
      { stdio: 'ignore' },
    );

    assert.deepEqual(await remoteOf(root), {
      host: 'git.acme.dev',
      owner: 'team',
      name: 'api',
      provider: null,
    });
  },
);

test(
  'remoteOf will not choose between two remotes that are not origin',
  { skip: !gitRuns() },
  async () => {
    const root = tempDir('kira-two-remotes-');
    execFileSync('git', ['-C', root, 'init'], { stdio: 'ignore' });
    execFileSync(
      'git',
      ['-C', root, 'remote', 'add', 'upstream', 'https://github.com/acme/api.git'],
      { stdio: 'ignore' },
    );
    execFileSync('git', ['-C', root, 'remote', 'add', 'fork', 'https://github.com/me/api.git'], {
      stdio: 'ignore',
    });

    assert.equal(await remoteOf(root), null);
  },
);

test('cloneUrl names the URL a public host clones from, and nothing else', () => {
  assert.equal(cloneUrl('github', 'acme', 'api'), 'https://github.com/acme/api.git');
  assert.equal(
    cloneUrl('gitlab', 'group', 'subgroup/project'),
    'https://gitlab.com/group/subgroup/project.git',
  );
  // A host Kira cannot name is one it cannot build a URL for either — the person is
  // told rather than handed a guess that would clone from somewhere else.
  assert.equal(cloneUrl('forgejo', 'acme', 'api'), null);
});

test(
  'cloneInto lands a repository under the parent, named after it',
  { skip: !gitRuns() },
  async () => {
    const origin = committedCheckout();
    const parent = tempDir('kira-clone-');

    const landed = await cloneInto(origin, parent, 'api');

    assert.equal(landed, join(parent, 'api'));
    // What landed is a checkout of the origin, which is what the join then reads.
    assert.equal(await hasRemote(landed), true);
  },
);

test(
  'cloneInto names the folder after the repository, not after a group',
  { skip: !gitRuns() },
  async () => {
    const origin = committedCheckout();
    const parent = tempDir('kira-clone-group-');

    const landed = await cloneInto(origin, parent, 'group/subgroup/project');

    assert.equal(landed, join(parent, 'project'));
  },
);

test('cloneInto raises what git said when it will not clone', { skip: !gitRuns() }, async () => {
  const parent = tempDir('kira-clone-fail-');

  await assert.rejects(cloneInto(join(parent, 'nowhere'), parent, 'gone'));
});

/** A checkout with one commit, and git configured so committing is allowed. */
function localCheckout(): string {
  const root = tempDir('kira-local-');
  const git = (...args: string[]): void => {
    execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  };
  git('init', '-b', 'main');
  git('config', 'user.email', 'kira@test');
  git('config', 'user.name', 'Kira');
  writeFileSync(join(root, 'a.txt'), 'one\ntwo\nthree\n');
  writeFileSync(join(root, 'b.txt'), 'bee\n');
  git('add', '-A');
  git('commit', '-m', 'first');

  return root;
}

/** Split a patch into its file header and its hunks, the way the pane does. */
function hunksOf(patch: string): { header: string; hunks: string[] } {
  const lines = patch.split('\n');
  const first = lines.findIndex((line) => line.startsWith('@@'));
  if (first === -1) return { header: patch, hunks: [] };

  const hunks: string[] = [];
  for (const line of lines.slice(first)) {
    if (line.startsWith('@@')) hunks.push(line);
    else if (hunks.length > 0) hunks[hunks.length - 1] += `\n${line}`;
  }

  return { header: lines.slice(0, first).join('\n'), hunks: hunks.map((h) => h.trimEnd()) };
}

test('statusOf groups what changed and names the branch', { skip: !gitRuns() }, async () => {
  isolatedGit();
  const root = localCheckout();

  writeFileSync(join(root, 'a.txt'), 'one\nTWO\nthree\n');
  writeFileSync(join(root, 'new.ts'), 'fresh\n');
  execFileSync('git', ['-C', root, 'add', 'a.txt'], { stdio: 'ignore' });
  writeFileSync(join(root, 'a.txt'), 'one\nTWO!\nthree\n');

  const status = await statusOf(root);

  assert.equal(status.branch, 'main');
  assert.deepEqual(status.staged, [{ path: 'a.txt', status: 'M' }]);
  assert.deepEqual(status.unstaged, [{ path: 'a.txt', status: 'M' }]);
  assert.deepEqual(status.untracked, [{ path: 'new.ts', status: '?' }]);
});

test('statusOf refuses a folder that is not a checkout', { skip: !gitRuns() }, async () => {
  await assert.rejects(statusOf(tempDir('kira-not-a-checkout-')), /not a git checkout/);
});

test('patchOf draws an unstaged change, a staged change and a new file', async (t) => {
  if (!gitRuns()) {
    t.skip('git is required to read a patch');
    return;
  }
  isolatedGit();
  const root = localCheckout();
  writeFileSync(join(root, 'a.txt'), 'one\nTWO\nthree\n');

  const unstaged = await patchOf(root, 'a.txt', false);
  assert.match(unstaged, /-two/);
  assert.match(unstaged, /\+TWO/);

  execFileSync('git', ['-C', root, 'add', 'a.txt'], { stdio: 'ignore' });
  const staged = await patchOf(root, 'a.txt', true);
  assert.match(staged, /\+TWO/);

  writeFileSync(join(root, 'new.ts'), 'fresh\nline\n');
  const untracked = await patchOf(root, 'new.ts', false);
  assert.match(untracked, /new file mode 100644/);
  assert.match(untracked, /\+fresh/);
  assert.match(untracked, /\+line/);
});

test('patchOf refuses a diff over the cap with a sentence', { skip: !gitRuns() }, async () => {
  isolatedGit();
  const root = localCheckout();
  writeFileSync(join(root, 'big.txt'), `${'x'.repeat(1024 * 1024 + 10)}\n`);

  await assert.rejects(patchOf(root, 'big.txt', false), /larger than the 1 MB/);
});

test('staging and unstaging moves one file between the groups', { skip: !gitRuns() }, async () => {
  isolatedGit();
  const root = localCheckout();
  writeFileSync(join(root, 'a.txt'), 'one\nTWO\nthree\n');

  await stagePaths(root, ['a.txt']);
  let status = await statusOf(root);
  assert.deepEqual(status.staged, [{ path: 'a.txt', status: 'M' }]);
  assert.deepEqual(status.unstaged, []);

  await unstagePaths(root, ['a.txt']);
  status = await statusOf(root);
  assert.deepEqual(status.staged, []);
  assert.deepEqual(status.unstaged, [{ path: 'a.txt', status: 'M' }]);
});

test('a single hunk can be staged while the file’s other hunks stay out', async (t) => {
  if (!gitRuns()) {
    t.skip('git is required to stage a hunk');
    return;
  }
  isolatedGit();
  const root = localCheckout();
  const lines = Array.from({ length: 20 }, (_, at) => `line ${at + 1}`);
  writeFileSync(join(root, 'wide.txt'), `${lines.join('\n')}\n`);
  execFileSync('git', ['-C', root, 'add', 'wide.txt'], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'commit', '-m', 'wide'], { stdio: 'ignore' });

  const changed = [...lines];
  changed[0] = 'LINE 1';
  changed[19] = 'LINE 20';
  writeFileSync(join(root, 'wide.txt'), `${changed.join('\n')}\n`);

  const { header, hunks } = hunksOf(await patchOf(root, 'wide.txt', false));
  assert.equal(hunks.length, 2, 'two edits far apart are two hunks');

  await applyPatchToIndex(root, `${header}\n${hunks[0]}\n`, false);

  const status = await statusOf(root);
  assert.deepEqual(status.staged, [{ path: 'wide.txt', status: 'M' }]);
  assert.deepEqual(status.unstaged, [{ path: 'wide.txt', status: 'M' }]);

  const staged = await patchOf(root, 'wide.txt', true);
  assert.match(staged, /LINE 1/);
  assert.doesNotMatch(staged, /LINE 20/);
});

test('committing records what is staged and empties the index', { skip: !gitRuns() }, async () => {
  isolatedGit();
  const root = localCheckout();
  writeFileSync(join(root, 'a.txt'), 'one\nTWO\nthree\n');

  await assert.rejects(commitStaged(root, '   '), /needs a message/);

  await stagePaths(root, ['a.txt']);
  await commitStaged(root, 'change a');

  const status = await statusOf(root);
  assert.deepEqual(status.staged, []);
  assert.equal((await logOf(root, 5))[0]?.subject, 'change a');
});

test('reverting a path puts it back the way HEAD has it', { skip: !gitRuns() }, async () => {
  isolatedGit();
  const root = localCheckout();
  writeFileSync(join(root, 'a.txt'), 'one\nTWO\nthree\n');
  execFileSync('git', ['-C', root, 'add', 'a.txt'], { stdio: 'ignore' });

  await revertPath(root, 'a.txt');

  const status = await statusOf(root);
  assert.deepEqual(status.staged, []);
  assert.deepEqual(status.unstaged, []);
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'one\ntwo\nthree\n');
});

test('switching branch refuses a dirty tree and otherwise moves HEAD', async (t) => {
  if (!gitRuns()) {
    t.skip('git is required to switch branch');
    return;
  }
  isolatedGit();
  const root = localCheckout();
  execFileSync('git', ['-C', root, 'branch', 'develop'], { stdio: 'ignore' });

  writeFileSync(join(root, 'a.txt'), 'one\nTWO\nthree\n');
  await assert.rejects(switchBranch(root, 'develop'), /uncommitted changes/);
  assert.equal((await statusOf(root)).branch, 'main', 'nothing moved');

  execFileSync('git', ['-C', root, 'checkout', '--', 'a.txt'], { stdio: 'ignore' });
  await switchBranch(root, 'develop');
  assert.equal((await statusOf(root)).branch, 'develop');
});

test('history lists commits newest first and names a commit’s files', async (t) => {
  if (!gitRuns()) {
    t.skip('git is required to read history');
    return;
  }
  isolatedGit();
  const root = localCheckout();
  writeFileSync(join(root, 'a.txt'), 'one\nTWO\nthree\n');
  execFileSync('git', ['-C', root, 'add', 'a.txt'], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'commit', '-m', 'second'], { stdio: 'ignore' });

  const history = await logOf(root, 5);
  assert.equal(history[0]?.subject, 'second');
  assert.equal(history[1]?.subject, 'first');
  assert.equal(history[0]?.hash.slice(0, 7), history[0]?.short);

  const files = await commitFilesOf(root, history[0]!.hash);
  assert.deepEqual(files, [{ path: 'a.txt', status: 'M' }]);
});

test('syncRemote says so when a checkout has no remote', { skip: !gitRuns() }, async () => {
  isolatedGit();
  const root = localCheckout();

  await assert.rejects(syncRemote(root, 'fetch'), /no remote to sync with/);
});
