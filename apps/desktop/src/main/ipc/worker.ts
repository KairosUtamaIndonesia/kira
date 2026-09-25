/**
 * The worker channel's handler.
 *
 * One thing to read and nothing to write: what this desktop is as a worker is the
 * main process's own knowledge — whether the server answered the last time it offered
 * itself, and what went wrong if it did not — so the window asks and is told. Nothing
 * a window can send changes it, which is why there is no check here beyond the
 * envelope: there is no argument to disbelieve.
 */
import { WORKER_CHANNELS, type Result, type WorkerStanding } from '../../preload/bridge.ts';
import { envelope } from './result.ts';

export { WORKER_CHANNELS };

/** What the handler needs from the main process. */
export interface WorkerDeps {
  /** What this desktop is, as the last offering left it. */
  standing(): WorkerStanding;
}

export interface WorkerHandlers {
  standing(): Promise<Result<WorkerStanding>>;
}

export function workerHandlers({ standing }: WorkerDeps): WorkerHandlers {
  return {
    standing: () => envelope(async () => standing()),
  };
}
