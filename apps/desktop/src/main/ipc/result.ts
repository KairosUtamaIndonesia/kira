/**
 * How a handler answers.
 *
 * A handler that throws crosses the process boundary as an opaque Error, which
 * tells the renderer nothing, so failures come back as values instead. The
 * guards beside it treat every argument as whatever the renderer sent, because
 * that is what a trust boundary means: the window is not a caller to be
 * believed, it is an input to be checked.
 */
import type { Result } from '../../preload/bridge.ts';

/** Run `work`, reporting failure as a value. */
export async function envelope<T>(work: () => T | Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** An id as it arrives from the renderer: only a non-empty string names something. */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Run `work` on an id from the renderer, or say what was missing. */
export function withId(
  id: unknown,
  complaint: string,
  work: (id: string) => Promise<void>,
): Promise<Result<null>> {
  if (!isId(id)) {
    return Promise.resolve({ ok: false, error: complaint });
  }

  return nothing(() => work(id));
}

/** Run a call that answers nothing, reporting failure as a value. */
export function nothing(work: () => Promise<void>): Promise<Result<null>> {
  return envelope(async () => {
    await work();
    return null;
  });
}
