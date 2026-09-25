import { strict as assert } from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../test-support/temp.ts';
import { watchFolders } from './watching.ts';

/**
 * Wait until something has happened rather than for a length of time: a
 * filesystem reports a write when it gets round to it, and how long that takes
 * belongs to the machine rather than to this test.
 */
async function waitFor(happened: () => boolean, what: string): Promise<void> {
  const until = Date.now() + 5000;

  while (!happened()) {
    if (Date.now() > until) throw new Error(`waited for ${what}, and it never happened`);

    await new Promise((settle) => setTimeout(settle, 5));
  }
}

/**
 * Long enough that a call which was going to arrive has arrived. Used where what
 * is being checked is that nothing else does — there is no condition to wait
 * for, so the wait is the assertion.
 */
async function settled(): Promise<void> {
  await new Promise((settle) => setTimeout(settle, 500));
}

/** Watch a folder, and any levels under it that the case names. */
function watchCase(folder: string, also: readonly string[], changed: () => void) {
  return watchFolders([folder, ...also.map((one) => join(folder, one))], changed);
}

interface Case {
  name: string;
  /** Done to the folder before the watch starts, for a case that needs a file there. */
  arrange?: (folder: string) => void;
  /** Levels under the folder that are named to the watch along with it. */
  also?: readonly string[];
  /** What happens to the folder while it is watched; answers a way to stop it. */
  happened: (folder: string) => (() => void) | undefined;
  /** How many changes the watcher is expected to report, and no more. */
  want: number;
  /** Whether the watch is stopped before anything happens at all. */
  stopped?: boolean;
}

/**
 * What a watch answers, over a real folder rather than a recorded one: the
 * events a filesystem sends and the gathering of them are the whole of what this
 * does, and neither is checkable against a fake.
 *
 * A change that arrives as several events, twenty files written in one go and a
 * burst that stops all have to come out as one call — while two bursts with
 * quiet between them are still two, and a watch that was stopped has nothing to
 * say. A run that never pauses is a different question and is asked on its own
 * below, because the answer to it is not a count.
 *
 * Only the levels named are watched, which is what makes opening the tab
 * immediate: a folder nobody is showing is not walked, so a change in one is
 * nothing this watch has to say about.
 */
const CASES: Case[] = [
  {
    name: 'a file written into the watched folder is one change',
    happened: (folder) => {
      writeFileSync(join(folder, 'written.ts'), '');
    },
    want: 1,
  },
  {
    name: 'a file deleted from the watched folder is one change',
    arrange: (folder) => {
      writeFileSync(join(folder, 'going.ts'), '');
    },
    happened: (folder) => {
      rmSync(join(folder, 'going.ts'));
    },
    want: 1,
  },
  {
    name: 'a file written in a level that was named is one change',
    arrange: (folder) => {
      mkdirSync(join(folder, 'deep'));
    },
    also: ['deep'],
    happened: (folder) => {
      writeFileSync(join(folder, 'deep', 'deeper.ts'), '');
    },
    want: 1,
  },
  {
    name: 'a file written in a level nobody named is not reported',
    arrange: (folder) => {
      mkdirSync(join(folder, 'unopened'));
    },
    happened: (folder) => {
      writeFileSync(join(folder, 'unopened', 'deeper.ts'), '');
    },
    want: 0,
  },
  {
    name: 'a burst of twenty writes is one change rather than twenty',
    happened: (folder) => {
      for (let one = 0; one < 20; one += 1) writeFileSync(join(folder, `burst-${one}.ts`), '');
    },
    want: 1,
  },
  {
    name: 'two bursts with quiet between them are two changes',
    happened: (folder) => {
      writeFileSync(join(folder, 'first.ts'), '');

      // Later than the window a burst is gathered for, so this is a second one
      // rather than more of the first.
      const second = setTimeout(() => {
        writeFileSync(join(folder, 'second.ts'), '');
      }, 400);

      return () => {
        clearTimeout(second);
      };
    },
    want: 2,
  },
  {
    name: 'nothing arrives after the watch is stopped',
    stopped: true,
    happened: (folder) => {
      writeFileSync(join(folder, 'after.ts'), '');
    },
    want: 0,
  },
];

for (const testCase of CASES) {
  test(testCase.name, async (t) => {
    const folder = tempDir('foundry-watch-');

    testCase.arrange?.(folder);

    let changes = 0;
    const watching = watchCase(folder, testCase.also ?? [], () => {
      changes += 1;
    });

    assert.notEqual(watching, null, 'a temporary folder is one the platform will watch');
    t.after(() => {
      watching?.stop();
    });

    if (testCase.stopped === true) watching?.stop();

    const stop = testCase.happened(folder);
    // Registered as well as called below, so a case that fails part-way through
    // does not leave a timer writing into a folder that is being thrown away.
    if (stop !== undefined) t.after(stop);

    if (testCase.want === 0) {
      await settled();
    } else {
      await waitFor(() => changes >= testCase.want, `${testCase.want} change(s)`);
      // What is happening stops before the settling, so a second call for the
      // same burst has its chance to arrive and be counted.
      stop?.();
      await settled();
    }

    assert.equal(changes, testCase.want);
  });
}

test('a run that writes without pausing is answered while it is still going', async (t) => {
  const folder = tempDir('foundry-watch-');

  let changes = 0;
  const watching = watchCase(folder, [], () => {
    changes += 1;
  });

  assert.notEqual(watching, null, 'a temporary folder is one the platform will watch');
  t.after(() => {
    watching?.stop();
  });

  /*
   * A turn writing files throughout never leaves the quiet window closed, so
   * nothing but the longest wait can answer it — and it has to answer while the
   * writing is still going, because waiting for a run to end is the one thing
   * the tree must not do. Twice, since one answer at the end would be the same
   * as waiting: the writing is never stopped here, so an answer that only
   * arrived once it stopped could not arrive at all.
   */
  const writing = setInterval(() => {
    writeFileSync(join(folder, 'churn.ts'), '');
  }, 40);

  t.after(() => {
    clearInterval(writing);
  });

  await waitFor(() => changes >= 2, 'two answers while the writing continues');
});

test('naming no levels watches nothing rather than watching everything', () => {
  // The pane always names at least the root, so this is the shape of the answer
  // rather than a case that happens: nothing named is nothing watched, not a
  // watch of the whole machine.
  assert.equal(
    watchFolders([], () => {}),
    null,
  );
});

test('a folder the platform will not watch is null rather than a failure', () => {
  // A path the platform refuses outright. The pane never names one; what is
  // being checked is the answer to a refusal — no watch, and nothing thrown for
  // the tree to draw as a failure to read a folder that is perfectly readable.
  assert.equal(
    watchFolders(['\0'], () => {}),
    null,
  );
});
