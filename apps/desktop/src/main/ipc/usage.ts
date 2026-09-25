/**
 * The usage channel's handler.
 *
 * One question — what this person has used this month — answered from the reading
 * the main process already holds, so the window draws a number instead of asking
 * the server again. Nobody else's usage can be asked for here: there is no person
 * to name, which is the server's own shape too (docs/adr/0005-allowances.md).
 */
import { USAGE_CHANNELS, type Result, type Usage } from '../../preload/bridge.ts';
import { envelope } from './result.ts';

export { USAGE_CHANNELS };

/** What the handler needs from the main process. */
export interface UsageDeps {
  /** The last reading, or null when nobody is signed in or none has arrived. */
  current(): Usage | null;
}

export interface UsageHandlers {
  load(): Promise<Result<Usage | null>>;
}

export function usageHandlers({ current }: UsageDeps): UsageHandlers {
  return {
    load: () => envelope(() => current()),
  };
}
