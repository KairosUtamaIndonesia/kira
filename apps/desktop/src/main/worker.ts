/**
 * The desktop offering itself for work (docs/adr/0012).
 *
 * A worker is what a person's machine offers while Kira is running and somebody
 * is signed in, and nothing about it is a decision: it does not pick up tickets, and
 * it does not decide what to run. Its own person starts a run on a ticket, and the
 * run is where the work happens. What this module does is the smaller half of that —
 * saying "this machine is here" often enough that the queue can trust it, and saying
 * "this machine is gone" on the way out so the claims it held can be claimed again.
 *
 * The one thing it does not do quietly is fail. A heartbeat that cannot reach the
 * server is kept as `trouble` rather than thrown away, because a desktop that has
 * stopped being heard from is exactly what a person watching a running ticket needs
 * to be told, and a failure nobody records looks identical to a machine that is fine.
 *
 * The worker's name for itself is derived rather than stored: the person it belongs
 * to and the machine it runs on, hashed, so the same person signing in on the same
 * laptop is the same worker after a restart — while two people sharing a machine are
 * two workers, and neither holds the other's claims. Nothing needs a new file on disk
 * for that, and no key ends up in an identifier.
 */
import { createHash } from 'node:crypto';
import type { WorkerStanding } from '../preload/bridge.ts';
import type { StoredKey } from './auth/keys.ts';
import type { TrackerAnswer } from './tracker.ts';

/** The server's half of the worker, as `auth/kira.ts` implements it. */
export interface WorkerWire {
  /** Offer this desktop: its id, what it is called, and the folders it can run in. */
  registerWorker(
    key: string,
    made: { id: string; name: string; workspaces: string[] },
  ): Promise<TrackerAnswer<WorkerStanding>>;
  /** Say it is still here, what it can run in, and what it is running. */
  heartbeatWorker(
    key: string,
    id: string,
    workspaces: string[],
    driving: string[],
  ): Promise<TrackerAnswer<WorkerStanding>>;
  /** Say it is gone. What it held goes with it. */
  workerGone(key: string, id: string): Promise<TrackerAnswer<unknown>>;
}

/** What the main process keeps of this desktop as a worker. */
export interface Worker {
  /**
   * This desktop's name for the server, or null when nobody is signed in.
   *
   * A claim taken by this machine and the run that follows it have to name the same
   * worker, so the run asks this rather than working the name out again.
   */
  id(): Promise<string | null>;
  /** Offer this desktop now, and answer what it is as a worker after. */
  offer(): Promise<WorkerStanding>;
  /** What this desktop is, as the last offering left it. */
  standing(): WorkerStanding;
  /** Offer it now, and keep offering it until stopped. */
  start(): void;
  /**
   * Stop offering, and say goodbye if the server ever heard from this one.
   *
   * A machine with a run in flight does not say goodbye: a claim a run holds belongs to
   * the run, and the run has not ended just because the window closed. It goes quiet
   * instead, which is a worker shown as away with its claim still its claim until somebody
   * takes that claim over (GH #74). Saying goodbye here would take the ticket out of
   * Running and leave an open run nobody could account for.
   */
  stop(): Promise<void>;
}

/**
 * How often a working desktop says it is still here.
 *
 * A third of the lease a worker's claims run on, so a machine that goes quiet has its
 * claim expire within a minute of the last heartbeat rather than at the same moment —
 * a heartbeat and a lease expiring together would make an ordinary hiccup look like a
 * dead machine.
 */
const BEAT_MS = 20_000;

/**
 * How long the goodbye on the way out is waited for.
 *
 * Closing the app must not hang on a server that is not there, and a goodbye that
 * never lands costs only what a crash costs: the claim stays until somebody takes it
 * over.
 */
const GOODBYE_MS = 3_000;

export function workerFor({
  token,
  device,
  workspaces,
  driving,
  wire,
  everyMs = BEAT_MS,
}: {
  /** The key this device holds and who it was issued to, or null when nobody is in. */
  token: () => Promise<StoredKey | null>;
  /** What this machine is called, which is what the worker is called too. */
  device: string;
  /** The folders this desktop can run in, as they stand now. */
  workspaces: () => string[];
  /** The tickets this machine is running right now, which is what stays fresh. */
  driving: () => string[];
  wire: WorkerWire;
  everyMs?: number;
}): Worker {
  let beat: ReturnType<typeof setInterval> | undefined;
  // Whether an offering is already on its way. A server that takes a heartbeat and then
  // says nothing must not collect a new request every beat.
  let offering = false;
  // Whether the server has ever heard from this one. Only a worker the server knows
  // can say goodbye: telling it about a worker it never met would be a request whose
  // answer means nothing.
  let known = false;
  let last: WorkerStanding = { name: device, here: false, trouble: null };

  return {
    async id() {
      const held = await token();

      return held === null ? null : workerIdOf(held, device);
    },

    async offer() {
      const held = await token();
      if (held === null) {
        // Nobody is signed in, so this desktop offers nothing and there is nothing
        // wrong: it is not a failure to be told about, it is the window's own state.
        known = false;
        last = { name: device, here: false, trouble: null };

        return last;
      }

      const id = workerIdOf(held, device);
      const folders = workspaces();
      // What is in flight is stated rather than implied: a run's claim is kept fresh by a
      // desktop that is working it, and a desktop that restarted is driving nothing even
      // though it is here (GH #74, #75).
      const answer = known
        ? await wire.heartbeatWorker(held.key, id, folders, driving())
        : await wire.registerWorker(held.key, { id, name: device, workspaces: folders });

      if (answer.kind === 'ok') {
        known = true;
        last = { name: device, here: true, trouble: null };

        return last;
      }

      // Nothing was written, so nothing is being offered. A refused registration is
      // as much a reason as an unreachable server is, and both are kept in the
      // server's or the wire's own words.
      known = false;
      last = { name: device, here: false, trouble: troubleIn(answer) };

      return last;
    },

    standing() {
      return last;
    },

    start() {
      const oneAtATime = () => {
        if (offering) return;
        offering = true;
        void this.offer().finally(() => {
          offering = false;
        });
      };

      // Offered before the first wait rather than after it: a machine that starts
      // working now should be visible now, not one beat from now.
      oneAtATime();
      beat ??= setInterval(oneAtATime, everyMs);
    },

    async stop() {
      if (beat !== undefined) clearInterval(beat);
      beat = undefined;

      // A run in flight keeps its claim: the run has not ended, and a worker that goes
      // quiet is shown as away with that claim still to its name rather than as one that
      // released it on the way out.
      if (driving().length > 0) {
        known = false;
        last = { ...last, here: false };

        return;
      }

      const held = await token();
      if (!known || held === null) {
        known = false;
        last = { ...last, here: false };

        return;
      }

      await atMost(wire.workerGone(held.key, workerIdOf(held, device)), GOODBYE_MS);
      known = false;
      last = { name: device, here: false, trouble: null };
    },
  };
}

/**
 * This person, on this machine.
 *
 * Hashed rather than spelled out: the id has to be the same across restarts and
 * different for two people on one machine, and it has to be neither a secret nor
 * somebody's address sitting in a row.
 */
function workerIdOf(held: StoredKey, device: string): string {
  const named = `${held.user.email.trim().toLowerCase()}@${device}`;

  return createHash('sha256').update(named).digest('hex').slice(0, 32);
}

/** Why there is no standing, in the words of whoever refused. */
function troubleIn(answer: TrackerAnswer<unknown>): string {
  if (answer.kind === 'refused') return answer.message;
  if (answer.kind === 'signed-out') return 'Kira no longer recognises this desktop.';

  return 'Kira could not be reached.';
}

/**
 * A promise, or nothing if it takes too long.
 *
 * The clock is unref'd so a goodbye that is never answered cannot hold the process
 * open after the window has gone.
 */
async function atMost<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
  });

  try {
    return await Promise.race([work, late]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
