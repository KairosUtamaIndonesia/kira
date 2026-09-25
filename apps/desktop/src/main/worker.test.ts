/**
 * The desktop offering itself for work.
 *
 * What is asserted here is mostly what the server is *not* asked. A machine nobody is
 * signed in on offers nothing and is not failing; a machine that was never heard from
 * cannot say goodbye; and a machine that has gone quiet says so rather than nothing.
 * The rest is the identifier: the same person on the same laptop has to be the same
 * worker after a restart, and two people sharing a machine have to be two.
 *
 * The wire is a stub, because the point is not what Foundry answers — one test file
 * covers that — but what this desktop does with an answer, including the ones that
 * never arrive.
 */
import { describe, expect, test } from 'bun:test';
import type { StoredKey } from './auth/keys.ts';
import type { TrackerAnswer } from './tracker.ts';
import { workerFor, type WorkerWire } from './worker.ts';

const ADA: StoredKey = {
  key: 'key-ada',
  user: { name: 'Ada Lovelace', email: 'ada@company.example' },
};
const GRACE: StoredKey = {
  key: 'key-grace',
  user: { name: 'Grace Hopper', email: 'grace@company.example' },
};

/** Every call a worker made, in order. */
interface Asked {
  what: string;
  key: string;
  id?: string;
  name?: string;
  workspaces?: string[];
  driving?: string[];
}

/**
 * A wire that answers whatever it is told to, and records what it was asked.
 *
 * `never` is the case that matters most: a server that accepts the request and then
 * says nothing at all, which is what a laptop closing on a train actually meets.
 */
function wire(
  answer: TrackerAnswer<unknown> = { kind: 'ok', body: {} },
  quirks: { never?: string[] } = {},
) {
  const asked: Asked[] = [];

  const held: WorkerWire = {
    registerWorker: async (key, made) => {
      asked.push({ what: 'offer', key, id: made.id, name: made.name, workspaces: made.workspaces });
      if (quirks.never?.includes('offer')) return await new Promise(() => {});

      return answer as TrackerAnswer<never>;
    },
    heartbeatWorker: async (key, id, workspaces, driving) => {
      asked.push({ what: 'beat', key, id, workspaces, driving });
      if (quirks.never?.includes('beat')) return await new Promise(() => {});

      return answer as TrackerAnswer<never>;
    },
    workerGone: async (key, id) => {
      asked.push({ what: 'gone', key, id });
      if (quirks.never?.includes('gone')) return await new Promise(() => {});

      return answer as TrackerAnswer<never>;
    },
  };

  return { held, asked };
}

/** A worker over a machine that holds whoever is handed to it. */
function workerOn(
  held: StoredKey | null,
  made = wire(),
  options: { device?: string; folders?: string[]; everyMs?: number; driving?: string[] } = {},
) {
  const folders = options.folders ?? ['/home/brandon/Workspace/kira'];

  return {
    made,
    worker: workerFor({
      token: async () => held,
      device: options.device ?? 'brandon-laptop',
      workspaces: () => folders,
      driving: () => options.driving ?? [],
      wire: made.held,
      ...(options.everyMs === undefined ? {} : { everyMs: options.everyMs }),
    }),
  };
}

describe('a desktop offering itself', () => {
  test('says nothing at all when nobody is signed in, and that is not trouble', async () => {
    const { made, worker } = workerOn(null);

    const standing = await worker.offer();

    expect(made.asked).toEqual([]);
    expect(standing).toEqual({ name: 'brandon-laptop', here: false, trouble: null });
  });

  test('offers its name, its machine, and the folders it can run in', async () => {
    const { made, worker } = workerOn(ADA, wire(), {
      folders: ['/home/brandon/Workspace/kira', '/home/brandon/Workspace/foundry'],
    });

    const standing = await worker.offer();

    expect(standing).toEqual({ name: 'brandon-laptop', here: true, trouble: null });
    expect(made.asked).toHaveLength(1);
    expect(made.asked[0]?.what).toBe('offer');
    expect(made.asked[0]?.key).toBe('key-ada');
    expect(made.asked[0]?.name).toBe('brandon-laptop');
    expect(made.asked[0]?.workspaces).toEqual([
      '/home/brandon/Workspace/kira',
      '/home/brandon/Workspace/foundry',
    ]);
  });

  test('says it is still here rather than offering again', async () => {
    const { made, worker } = workerOn(ADA);

    await worker.offer();
    await worker.offer();

    expect(made.asked.map((each) => each.what)).toEqual(['offer', 'beat']);
    // The same worker both times: a heartbeat for anybody else's id would be a
    // desktop claiming to be a machine it is not.
    expect(made.asked[1]?.id).toBe(made.asked[0]?.id);
    expect(made.asked[1]?.workspaces).toEqual(['/home/brandon/Workspace/kira']);
  });

  test('is the same worker after a restart, and a different one for a different person', async () => {
    const first = workerOn(ADA);
    await first.worker.offer();

    // A restart: the same key on the same machine, a new keeper.
    const again = workerOn(ADA);
    await again.worker.offer();
    expect(again.made.asked[0]?.id).toBe(first.made.asked[0]?.id);

    // Somebody else on the same machine is somebody else's worker, so neither can
    // hold the other's claims.
    const other = workerOn(GRACE);
    await other.worker.offer();
    expect(other.made.asked[0]?.id).not.toBe(first.made.asked[0]?.id);

    // And the same person somewhere else is a different machine.
    const elsewhere = workerOn(ADA, wire(), { device: 'brandon-desktop' });
    await elsewhere.worker.offer();
    expect(elsewhere.made.asked[0]?.id).not.toBe(first.made.asked[0]?.id);

    // Nothing about it says who it is: it is an identifier, not an address.
    expect(first.made.asked[0]?.id).not.toInclude('ada');
    expect(first.made.asked[0]?.id).not.toInclude('brandon-laptop');
  });

  test('keeps what went wrong rather than failing quietly', async () => {
    const unreachable = workerOn(ADA, wire({ kind: 'unavailable' }));
    const standing = await unreachable.worker.offer();

    expect(standing.here).toBe(false);
    expect(standing.trouble).toBe('Foundry could not be reached.');

    const refused = workerOn(ADA, wire({ kind: 'refused', message: 'No such prefix.' }));
    const refusedStanding = await refused.worker.offer();
    expect(refusedStanding).toEqual({
      name: 'brandon-laptop',
      here: false,
      trouble: 'No such prefix.',
    });

    const stale = workerOn(ADA, wire({ kind: 'signed-out' }));
    const staleStanding = await stale.worker.offer();
    expect(staleStanding.here).toBe(false);
    expect(staleStanding.trouble).toBe('Foundry no longer recognises this desktop.');
  });

  test('offers again from scratch after a refused offering, rather than heartbeating it', async () => {
    const made = wire({ kind: 'unavailable' });
    const { worker } = workerOn(ADA, made);

    await worker.offer();
    await worker.offer();

    // Nothing was written the first time, so the second attempt is an offering and not
    // a heartbeat for a worker the server has never met.
    expect(made.asked.map((each) => each.what)).toEqual(['offer', 'offer']);
  });

  test('says goodbye when it stops, and again is not another goodbye', async () => {
    const { made, worker } = workerOn(ADA);

    await worker.offer();
    await worker.stop();

    expect(made.asked.map((each) => each.what)).toEqual(['offer', 'gone']);
    expect(made.asked[1]?.id).toBe(made.asked[0]?.id);
    expect(worker.standing()).toEqual({ name: 'brandon-laptop', here: false, trouble: null });

    await worker.stop();
    expect(made.asked).toHaveLength(2);
  });

  test('cannot say goodbye when the server never heard from it', async () => {
    const { made, worker } = workerOn(ADA, wire({ kind: 'unavailable' }));

    await worker.offer();
    await worker.stop();

    expect(made.asked.map((each) => each.what)).toEqual(['offer']);
  });

  test('says which runs it is driving, so a run it is not driving goes stale', async () => {
    const { made, worker } = workerOn(ADA, wire(), { driving: ['ticket-1', 'ticket-2'] });

    // The first offering registers; every one after it says what is in flight. What it says
    // is the whole difference between a claim kept fresh by a machine working it and a claim
    // refreshed forever by a machine that merely happens to be on: a desktop that restarted
    // is here with nothing in flight, and a run it left behind has to be allowed to go stale
    // or nobody can ever take it over (GH #74, #75).
    await worker.offer();
    await worker.offer();

    expect(made.asked).toEqual([
      {
        what: 'offer',
        key: 'key-ada',
        id: expect.any(String),
        name: 'brandon-laptop',
        workspaces: ['/home/brandon/Workspace/kira'],
      },
      {
        what: 'beat',
        key: 'key-ada',
        id: expect.any(String),
        workspaces: ['/home/brandon/Workspace/kira'],
        driving: ['ticket-1', 'ticket-2'],
      },
    ]);
  });

  test('goes quiet with a run in flight rather than saying goodbye for it', async () => {
    const { made, worker } = workerOn(ADA, wire(), { driving: ['ticket-1'] });

    await worker.offer();
    await worker.stop();

    // No goodbye, so the server keeps hearing nothing from this desktop and shows it away
    // — with its claim still its claim. Saying goodbye would delete the worker and release
    // the claim, which would take the ticket out of Running and leave an open run nobody
    // could account for (GH #74).
    expect(made.asked.map((each) => each.what)).toEqual(['offer']);
    expect(worker.standing()).toEqual({ name: 'brandon-laptop', here: false, trouble: null });
  });

  test('does not hang the quit on a server that answers nothing', async () => {
    const { worker } = workerOn(ADA, wire({ kind: 'ok', body: {} }, { never: ['gone'] }));
    await worker.offer();
    const started = Date.now();
    await worker.stop();

    // The goodbye is given a few seconds and no more: closing the window must not wait
    // on a machine that is not there, and a goodbye that never lands costs only what a
    // crash costs.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(worker.standing().here).toBe(false);
  });

  test('keeps offering until it is stopped, and stops offering after', async () => {
    const { made, worker } = workerOn(ADA, wire(), { everyMs: 20 });

    worker.start();
    await until(() => made.asked.filter((each) => each.what === 'beat').length >= 2);
    expect(made.asked[0]?.what).toBe('offer');

    await worker.stop();
    const after = made.asked.length;
    await Bun.sleep(100);

    // Nothing more after the goodbye, whatever the beat's own rhythm was — and the
    // goodbye is the last thing asked, so the run of beats ended with it.
    expect(made.asked.length).toBe(after);
    expect(made.asked.at(-1)?.what).toBe('gone');
  });

  test('asks for one heartbeat at a time, however long the server takes', async () => {
    // The server takes the beat and says nothing, which is the shape of a laptop that
    // closed mid-request — and the shape that would otherwise stack up requests every
    // beat for as long as it lasted.
    const made = wire({ kind: 'ok', body: {} }, { never: ['beat'] });
    const { worker } = workerOn(ADA, made, { everyMs: 20 });

    worker.start();
    await Bun.sleep(120);

    expect(made.asked.map((each) => each.what)).toEqual(['offer', 'beat']);

    // Stopped even though the beat is still hanging: a check that leaves a clock
    // running keeps ticking through every test after it.
    await worker.stop();
  });

  test('stops being here the moment somebody signs out', async () => {
    let held: StoredKey | null = ADA;
    const made = wire();
    const worker = workerFor({
      token: async () => held,
      device: 'brandon-laptop',
      workspaces: () => [],
      driving: () => [],
      wire: made.held,
    });

    await worker.offer();
    held = null;
    await worker.stop();

    // Signed out, there is no key to say goodbye with, so there is no goodbye — and the
    // desktop is not here any more either.
    expect(made.asked.map((each) => each.what)).toEqual(['offer']);
    expect(worker.standing()).toEqual({ name: 'brandon-laptop', here: false, trouble: null });
  });
});

/** Wait for something to become true, rather than for a clock to run out. */
async function until(ready: () => boolean, within = 2_000): Promise<void> {
  const deadline = Date.now() + within;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('it never happened');
    await Bun.sleep(5);
  }
}
