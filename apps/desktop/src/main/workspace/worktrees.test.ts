/**
 * The checkout a run works in.
 *
 * Written against a real repository rather than a fake git, because every rule here is
 * about what git actually does: a branch that already exists is checked out rather than
 * made again, an abandoned worktree is cleared out of the way rather than failing the
 * run, and a worktree that is dropped leaves its branch behind. A stub would assert
 * which flags were passed and nothing about the result.
 */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { tempDir } from '../test-support/temp.ts';
import { runWorktrees } from './worktrees.ts';

/** A configuration of this test's own, so an operator's git settings change nothing. */
function isolatedGit(): void {
  const home = tempDir('foundry-runs-home-');
  writeFileSync(join(home, 'gitconfig'), '');

  process.env['GIT_CONFIG_GLOBAL'] = join(home, 'gitconfig');
  process.env['GIT_CONFIG_SYSTEM'] = devNull;
  // Commits are made by the two tests that need a starting point, and a machine with no
  // identity of its own must not be why they fail.
  process.env['GIT_AUTHOR_NAME'] = 'Foundry';
  process.env['GIT_AUTHOR_EMAIL'] = 'foundry@example.test';
  process.env['GIT_COMMITTER_NAME'] = 'Foundry';
  process.env['GIT_COMMITTER_EMAIL'] = 'foundry@example.test';
}

before(isolatedGit);

const temporary: string[] = [];
after(() => {
  for (const each of temporary) rmSync(each, { recursive: true, force: true });
});

/** A checkout to run in, with one commit so there is a branch to work from. */
function checkout(): string {
  const root = tempDir('foundry-project-');
  execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main'], { stdio: 'ignore' });
  writeFileSync(join(root, 'README.md'), 'the project\n');
  execFileSync('git', ['-C', root, 'add', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'the first commit'], { stdio: 'ignore' });

  return root;
}

/** Where a run of this ticket would work. */
function runPath(): string {
  return join(tempDir('foundry-run-'), 'work');
}

/** The branches a checkout knows. */
function branchNames(folder: string): string[] {
  return execFileSync('git', ['-C', folder, 'branch', '--list', '--format=%(refname:short)'], {
    encoding: 'utf8',
  })
    .split('\n')
    .map((each) => each.trim())
    .filter((each) => each !== '');
}

function originFor(project: string): string {
  const remote = mkdtempSync(join(tmpdir(), 'foundry-remote-'));
  temporary.push(remote);
  execFileSync('git', ['init', '-q', '--bare', remote], { stdio: 'ignore' });
  execFileSync('git', ['-C', project, 'remote', 'add', 'origin', remote], { stdio: 'ignore' });
  execFileSync('git', ['-C', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main'], {
    stdio: 'ignore',
  });
  execFileSync('git', ['-C', project, 'push', '-q', '-u', 'origin', 'main'], {
    stdio: 'ignore',
  });

  return remote;
}

function commit(folder: string, file: string, contents: string, message: string): void {
  writeFileSync(join(folder, file), contents);
  execFileSync('git', ['-C', folder, 'add', file], { stdio: 'ignore' });
  execFileSync('git', ['-C', folder, 'commit', '-q', '-m', message], { stdio: 'ignore' });
}

test('a run works on the ticket branch, made from where the project is now', async () => {
  const project = checkout();
  const into = runPath();

  const made = await runWorktrees().make(project, 'kira-1-a-ticket-knows-its-branch', into);

  assert.equal(made, into);
  // The branch is there, and it starts from what the project has already got — a run
  // begins from the person's own work rather than from a history of its own.
  assert.deepEqual(branchNames(project).sort(), ['kira-1-a-ticket-knows-its-branch', 'main']);
  assert.equal(readFileSync(join(into, 'README.md'), 'utf8'), 'the project\n');
});

test('a branch that already exists is worked on again rather than made twice', async () => {
  const project = checkout();
  const branch = 'kira-2-a-ticket-run-twice';

  const first = runPath();
  await runWorktrees().make(project, branch, first);
  writeFileSync(join(first, 'made.ts'), 'what the first run did\n');
  execFileSync('git', ['-C', first, 'add', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', first, 'commit', '-q', '-m', 'the first run'], { stdio: 'ignore' });
  await runWorktrees().drop(project, first);

  // A second try at the same ticket: the same branch, and what the first run committed
  // is already there. Starting again from the first commit would throw its work away.
  const second = runPath();
  await runWorktrees().make(project, branch, second);

  assert.equal(readFileSync(join(second, 'made.ts'), 'utf8'), 'what the first run did\n');
  assert.deepEqual(branchNames(project).sort(), [branch, 'main']);
});

test('two runs on one project get two checkouts, and neither disturbs the other', async () => {
  const project = checkout();

  const one = runPath();
  const two = runPath();
  await runWorktrees().make(project, 'kira-3-one', one);
  await runWorktrees().make(project, 'kira-4-two', two);

  // What one run writes is not what the other one sees, and the person's own folder is
  // left with neither of them in it.
  writeFileSync(join(one, 'one.ts'), 'the first run\n');
  assert.equal(existsSync(join(two, 'one.ts')), false);
  assert.equal(existsSync(join(project, 'one.ts')), false);
  assert.equal(existsSync(join(project, 'README.md')), true);
});

test('a run that ends takes its checkout away and leaves its branch', async () => {
  const project = checkout();
  const into = runPath();

  await runWorktrees().make(project, 'kira-5-a-run-that-ends', into);
  writeFileSync(join(into, 'half-done.ts'), 'uncommitted\n');
  await runWorktrees().drop(project, into);

  assert.equal(existsSync(into), false);
  assert.deepEqual(branchNames(project).sort(), ['kira-5-a-run-that-ends', 'main']);
});

test('a checkout a run abandoned is cleared out of the way of the next one', async () => {
  const project = checkout();
  const into = runPath();
  const branch = 'kira-6-a-run-that-was-killed';

  // A run whose machine was closed: the checkout is still registered, with work in it
  // that was never committed.
  await runWorktrees().make(project, branch, into);
  writeFileSync(join(into, 'half-done.ts'), 'uncommitted\n');

  // The next run on the same ticket gets a checkout rather than a refusal, which is what
  // would otherwise happen for as long as that path existed.
  const made = await runWorktrees().make(project, branch, into);

  assert.equal(made, into);
  assert.equal(existsSync(join(into, 'half-done.ts')), false);
  assert.equal(readFileSync(join(into, 'README.md'), 'utf8'), 'the project\n');
});

test('a folder that is not a checkout has no run to give', async () => {
  const nowhere = tempDir('foundry-not-a-project-');

  assert.equal(await runWorktrees().make(nowhere, 'kira-7', runPath()), null);
});

test('a folder that is gone has no run to give either', async () => {
  assert.equal(
    await runWorktrees().make(join(tmpdir(), 'foundry-gone-nowhere'), 'kira-8', runPath()),
    null,
  );
});

test('the first spec run pushes its branch and later slices start from it', async () => {
  const project = checkout();
  const remote = mkdtempSync(join(tmpdir(), 'foundry-remote-'));
  temporary.push(remote);
  execFileSync('git', ['init', '-q', '--bare', remote], { stdio: 'ignore' });
  execFileSync('git', ['-C', project, 'remote', 'add', 'origin', remote], { stdio: 'ignore' });
  execFileSync('git', ['-C', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main'], {
    stdio: 'ignore',
  });
  execFileSync('git', ['-C', project, 'push', '-q', '-u', 'origin', 'main'], { stdio: 'ignore' });

  const specBranch = 'fnd-9-the-spec';
  assert.equal(await runWorktrees().prepareSpec(project, specBranch), specBranch);
  assert.match(
    execFileSync('git', ['--git-dir', remote, 'show-ref', '--heads', specBranch], {
      encoding: 'utf8',
    }),
    new RegExp(`refs/heads/${specBranch}`),
  );
  // Existing spec branches still need a pushable remote before another run can start.
  assert.equal(await runWorktrees().prepareSpec(project, specBranch), specBranch);

  const specInto = runPath();
  await runWorktrees().make(project, specBranch, specInto);
  writeFileSync(join(specInto, 'spec.md'), 'the spec\n');
  execFileSync('git', ['-C', specInto, 'add', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', specInto, 'commit', '-q', '-m', 'the spec'], { stdio: 'ignore' });
  await runWorktrees().drop(project, specInto);

  const sliceInto = runPath();
  await runWorktrees().make(project, 'fnd-10-a-slice', sliceInto, specBranch);
  assert.equal(
    execFileSync('git', ['-C', sliceInto, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    execFileSync('git', ['-C', project, 'rev-parse', specBranch], { encoding: 'utf8' }).trim(),
  );
});

test('accepting a slice cleanly merges and pushes into the spec branch', async () => {
  const project = checkout();
  const remote = originFor(project);
  const trees = runWorktrees();
  const specBranch = 'fnd-12-spec';
  await trees.prepareSpec(project, specBranch);

  const sliceInto = runPath();
  await trees.make(project, 'fnd-13-slice', sliceInto, specBranch);
  commit(sliceInto, 'slice.ts', 'accepted\n', 'the accepted slice');
  await trees.drop(project, sliceInto);

  const merged = await trees.mergeSpec(project, specBranch, 'fnd-13-slice');

  assert.deepEqual(merged, { kind: 'merged' });
  const accepted = execFileSync(
    'git',
    ['--git-dir', remote, 'show', `refs/heads/${specBranch}:slice.ts`],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(accepted, 'accepted\n');
  assert.equal(
    execFileSync('git', ['-C', project, 'rev-parse', specBranch], { encoding: 'utf8' }).trim(),
    execFileSync('git', ['--git-dir', remote, 'rev-parse', specBranch], {
      encoding: 'utf8',
    }).trim(),
  );

  // A later run refreshes the local shared branch from the pushed result, not from the
  // project folder's unrelated branch.
  await trees.prepareSpec(project, specBranch);
  const nextInto = runPath();
  await trees.make(project, 'fnd-18-next-slice', nextInto, specBranch);
  assert.equal(readFileSync(join(nextInto, 'slice.ts'), 'utf8'), 'accepted\n');
});

test('a push refusal leaves the spec branch and remote unchanged', async () => {
  const project = checkout();
  const remote = originFor(project);
  const trees = runWorktrees();
  const specBranch = 'fnd-14-spec';
  await trees.prepareSpec(project, specBranch);
  const before = execFileSync('git', ['-C', project, 'rev-parse', specBranch], {
    encoding: 'utf8',
  }).trim();

  const sliceInto = runPath();
  await trees.make(project, 'fnd-15-slice', sliceInto, specBranch);
  commit(sliceInto, 'slice.ts', 'refused\n', 'the refused slice');
  await trees.drop(project, sliceInto);
  writeFileSync(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n');
  execFileSync('chmod', ['+x', join(remote, 'hooks', 'pre-receive')]);

  const result = await trees.mergeSpec(project, specBranch, 'fnd-15-slice');

  assert.equal(result.kind, 'refused');
  assert.equal(
    execFileSync('git', ['-C', project, 'rev-parse', specBranch], { encoding: 'utf8' }).trim(),
    before,
  );
  assert.equal(
    execFileSync('git', ['--git-dir', remote, 'rev-parse', specBranch], {
      encoding: 'utf8',
    }).trim(),
    before,
  );
});

test('a merge conflict leaves no partial push and reports the conflicting file', async () => {
  const project = checkout();
  const remote = originFor(project);
  const trees = runWorktrees();
  const specBranch = 'fnd-16-spec';
  await trees.prepareSpec(project, specBranch);

  const sliceInto = runPath();
  await trees.make(project, 'fnd-17-slice', sliceInto, specBranch);
  commit(sliceInto, 'shared.txt', 'slice\n', 'the conflicting slice');
  await trees.drop(project, sliceInto);

  const specInto = runPath();
  await trees.make(project, specBranch, specInto);
  commit(specInto, 'shared.txt', 'spec\n', 'the spec changed too');
  await trees.drop(project, specInto);
  const before = execFileSync('git', ['--git-dir', remote, 'rev-parse', specBranch], {
    encoding: 'utf8',
  }).trim();

  const result = await trees.mergeSpec(project, specBranch, 'fnd-17-slice');

  assert.equal(result.kind, 'conflict');
  assert.match(result.reason, /shared\.txt/);
  assert.equal(
    execFileSync('git', ['--git-dir', remote, 'rev-parse', specBranch], {
      encoding: 'utf8',
    }).trim(),
    before,
  );
});

test('a spec with an unreachable origin is refused before making its branch', async () => {
  const project = checkout();
  execFileSync('git', ['-C', project, 'remote', 'add', 'origin', join(project, 'gone.git')], {
    stdio: 'ignore',
  });

  assert.equal(await runWorktrees().prepareSpec(project, 'fnd-11-no-remote'), null);
  assert.deepEqual(branchNames(project), ['main']);
});
