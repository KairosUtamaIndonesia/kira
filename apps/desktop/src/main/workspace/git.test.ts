import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { devNull } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { changedByGit, insideFolder, listedByGit, splitListing } from './git.ts';
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

test('a folder that is not a checkout is null, which is git saying nothing', async (t) => {
  if (!gitRuns()) {
    t.skip('no git can be run here — a machine without one is ADR 0014’s revisit condition');
    return;
  }

  const folder = tempDir('kira-not-a-checkout-');

  assert.equal(await listedByGit(folder), null);
  assert.equal(await changedByGit(folder), null);
});
