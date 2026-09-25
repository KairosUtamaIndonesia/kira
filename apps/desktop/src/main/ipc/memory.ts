/**
 * The memory channel's handlers.
 *
 * The settings page's own surface: what this person decided about memory, and a
 * change to it. `load` answers from the reading the main process already holds
 * rather than asking the server again — that reading is the same one a turn and a
 * compaction consult, so what the page shows and what the app does cannot
 * disagree about it.
 */
import {
  MEMORY_CHANNELS,
  type MemoryChoice,
  type MemorySettings,
  type Result,
} from '../../preload/bridge.ts';
import { envelope, isId } from './result.ts';

export { MEMORY_CHANNELS };

/** What the handlers need from the main process. */
export interface MemoryDeps {
  /** The last reading, or null when nobody is signed in or none has arrived. */
  current(): MemorySettings | null;
  /** Write a decision down. Answers the reading that is in force afterwards. */
  save(decided: MemoryChoice): Promise<MemorySettings>;
}

export interface MemoryHandlers {
  load(): Promise<Result<MemorySettings | null>>;
  save(decided: unknown): Promise<Result<MemorySettings>>;
}

export function memoryHandlers({ current, save }: MemoryDeps): MemoryHandlers {
  return {
    load: () => envelope(() => current()),

    save: (decided) => {
      const asked = decidedIn(decided);
      if (asked === null) {
        return Promise.resolve({ ok: false, error: 'That is not a memory setting.' });
      }

      // The server's refusal is raised by the keeper and reported as a value here,
      // so the page shows why it would not take rather than an opaque failure.
      return envelope(() => save(asked));
    },
  };
}

/**
 * What the renderer asked for, or null when it is not a decision at all.
 *
 * The window is an input to be checked rather than a caller to be believed
 * (./result.ts), and there are exactly two things to check: whether memory runs is
 * a boolean, and a model is a name or nothing.
 */
function decidedIn(value: unknown): MemoryChoice | null {
  if (typeof value !== 'object' || value === null) return null;

  const held = value as { enabled?: unknown; chosen?: unknown };
  if (typeof held.enabled !== 'boolean') return null;
  if (held.chosen !== null && !isId(held.chosen)) return null;

  return { enabled: held.enabled, chosen: held.chosen };
}
