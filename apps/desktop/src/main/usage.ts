/**
 * The reading the window shows, kept rather than fetched on demand: a turn that
 * just finished is what changes it, and a window should not have to ask twice for
 * a number it already has. What it *is* is the shared contract's business, since
 * the renderer draws it (src/preload/bridge.ts).
 */
import type { Usage } from '../preload/bridge.ts';

/** What the server answered when it was asked. */
export type UsageAnswer = { kind: 'ok'; body: unknown } | { kind: 'unavailable' };

export interface UsageKeeper {
  /** The last reading, or null when there has not been one. */
  current(): Usage | null;
  /** Ask the server again. Answers the reading it now holds. */
  refresh(): Promise<Usage | null>;
  /** Hear every new reading. Returns a way to stop hearing them. */
  onChange(listener: (reading: Usage | null) => void): () => void;
}

export function usageFor({
  token,
  read,
}: {
  /** The key this device holds, or null when nobody has signed in. */
  token: () => Promise<string | null>;
  read: (key: string) => Promise<UsageAnswer>;
}): UsageKeeper {
  let latest: Usage | null = null;
  const listeners = new Set<(reading: Usage | null) => void>();

  function tell(reading: Usage | null): void {
    latest = reading;
    for (const listener of listeners) listener(reading);
  }

  return {
    current: () => latest,

    /**
     * Ask what this person has used, and tell the window.
     *
     * A server that cannot be asked leaves the last reading standing rather than
     * blanking the window: "I could not ask" and "you have used nothing" are
     * different facts, and only the second is worth forgetting a number over. The
     * model catalog follows the same rule for the same reason.
     */
    async refresh() {
      const key = await token();
      if (key === null) {
        tell(null);
        return null;
      }

      const answer = await read(key);
      if (answer.kind === 'unavailable') return latest;

      const reading = usageIn(answer.body);
      if (reading === null) return latest;

      tell(reading);
      return reading;
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * What the server said, or null when it said something else.
 *
 * A body that is not a reading is no reading. The window either shows a number or
 * shows nothing, and one invented from a shape the server never promised would be
 * worse than an empty space — the same reasoning the catalog's reader follows.
 */
export function usageIn(body: unknown): Usage | null {
  const said = body as { allowance?: unknown; used?: unknown; warned?: unknown } | null;
  if (typeof said?.allowance !== 'number' || typeof said.used !== 'number') return null;

  // The warning is the server's to decide, so anything but a plain true is no
  // warning: the threshold lives with the allowance it is measured against.
  return { allowance: said.allowance, used: said.used, warned: said.warned === true };
}
