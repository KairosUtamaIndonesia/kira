/**
 * What this person decided about memory, kept rather than fetched on demand.
 *
 * The desktop asks the server once and holds the answer, because two things need
 * it and neither can wait: every turn decides whether the observer runs, and every
 * compaction decides whether the reflector does and which model it runs on. A
 * setting that lives on the server is also not one this process can read for
 * itself, so what it holds *is* the desktop's copy of it.
 *
 * What it is is the shared contract's business, since the window draws the
 * settings page from it (src/preload/bridge.ts).
 */
import type { MemoryChoice, MemorySettings } from '../preload/bridge.ts';

/** What the server answered when it was asked, or why it could not be. */
export type MemoryAnswer =
  | { kind: 'ok'; body: unknown }
  | { kind: 'refused'; message: string }
  | { kind: 'unavailable' };

/**
 * Where this person's decisions are read from, for whoever needs them.
 *
 * A getter rather than a value because it is read where it matters — a turn
 * deciding whether to write the ledger down, a compaction deciding what to ask a
 * model — and a session that booted an hour ago has to see a switch turned since.
 * Undefined is a caller that was handed none, which is not a reason to stop.
 */
export type MemorySource = () => MemorySettings | null;

/**
 * Whether memory runs, as this person decided.
 *
 * Unknown reads as on: a machine that has not been told anything runs the way the
 * server's own default does, which is memory running. One spelling of that, because
 * two places ask it and "nobody said" must not mean two things.
 */
export function memoryRuns(source: MemorySource | undefined): boolean {
  return source?.()?.enabled !== false;
}

export interface MemoryKeeper {
  /** The last reading, or null when there has not been one. */
  current(): MemorySettings | null;
  /** Ask the server again. Answers the reading it now holds. */
  refresh(): Promise<MemorySettings | null>;
  /** Write down a change, and hold what the server answered. Throws when it refuses. */
  save(decided: MemoryChoice): Promise<MemorySettings>;
}

export function memoryFor({
  token,
  read,
  write,
}: {
  /** The key this device holds, or null when nobody has signed in. */
  token: () => Promise<string | null>;
  read: (key: string) => Promise<MemoryAnswer>;
  write: (key: string, decided: MemoryChoice) => Promise<MemoryAnswer>;
}): MemoryKeeper {
  let latest: MemorySettings | null = null;

  return {
    current: () => latest,

    /**
     * Ask what this person decided, and hold the answer.
     *
     * A server that cannot be asked leaves the last reading standing, the way the
     * usage reading does and for the same reason: "I could not ask" and "you
     * decided nothing" are different facts, and the second is the one where memory
     * runs on the defaults. Only signing out clears it, because then there is no
     * longer a person whose settings these are.
     */
    async refresh() {
      const key = await token();
      if (key === null) {
        latest = null;
        return null;
      }

      const answer = await read(key);
      if (answer.kind !== 'ok') return latest;

      const settings = memoryIn(answer.body);
      if (settings === null) return latest;

      latest = settings;
      return settings;
    },

    /**
     * Write a change through, and hold what comes back rather than what was sent.
     *
     * The answer is what the server decided, which is not always what the window
     * asked for: a model the pool is not offering is refused, and the reading that
     * returns is the one still in force. A refusal is raised rather than returned
     * so the window shows the server's own words about it — it is the party that
     * knows why, and a person told "that could not be saved" learns nothing they
     * can act on.
     */
    async save(decided) {
      const key = await token();
      if (key === null) throw new Error('Nobody is signed in.');

      const answer = await write(key, decided);
      if (answer.kind === 'refused') throw new Error(answer.message);

      const settings = answer.kind === 'ok' ? memoryIn(answer.body) : null;
      if (settings === null) throw new Error('That change could not be saved.');

      latest = settings;
      return settings;
    },
  };
}

/**
 * What the server said, or null when it said something else.
 *
 * A body that is not settings is no settings, the same rule the usage reading and
 * the catalog follow: a switch drawn from a shape the server never promised would
 * be worse than an empty space. Nothing recommended is a real reading — it is what
 * a server whose pool cannot be asked answers — so null is allowed here and only
 * a wrong *kind* of value is refused.
 */
export function memoryIn(body: unknown): MemorySettings | null {
  const said = body as { enabled?: unknown; chosen?: unknown; recommended?: unknown } | null;
  if (typeof said?.enabled !== 'boolean') return null;

  const chosen = nameIn(said.chosen);
  const recommended = nameIn(said.recommended);
  if (chosen === undefined || recommended === undefined) return null;

  return { enabled: said.enabled, chosen, recommended };
}

/** A model's id, or null for none, or undefined for something that is neither. */
function nameIn(value: unknown): string | null | undefined {
  if (value === null) return null;

  return typeof value === 'string' && value !== '' ? value : undefined;
}
