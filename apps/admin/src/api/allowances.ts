import { treaty } from '@elysiajs/eden';
import type { App } from '@foundry/server/contract';
import { type Loaded, reasonFor } from './result';

/**
 * Foundry's own routes, typed by the server rather than by a copy of them
 * (docs/adr/0008-typed-routes.md). The address is this page's own origin, because
 * the console is one origin with the API: in production the server serves it, and
 * in development Vite proxies `/api` to it.
 */
const foundry = treaty<App>(window.location.origin);

/** One request that was turned away, as the console reads it back. */
export interface Refusal {
  at: string;
  model: string;
  reason: string;
}

/** One person's month, as the console draws it. */
export interface Reading {
  allowance: number;
  used: number;
  warned: boolean;
  /** The number they were given, or null when the default applies to them. */
  override: number | null;
  /** What they were turned away for this month, and why. */
  refusals: Refusal[];
}

/** What each person on the screen has used, by their id. */
export type Readings = Record<string, Loaded<Reading>>;

/** What one person has used this month, and what they are allowed. */
export async function readAllowance(userId: string): Promise<Loaded<Reading>> {
  const { data, error } = await foundry.api.admin.usage({ userId }).get();
  if (error) {
    return {
      ok: false,
      message: why(error, 'Foundry would not say what this person has used.'),
    };
  }

  return { ok: true, value: readingOf(data) };
}

/**
 * Give somebody an allowance of their own, or take it away.
 *
 * Null is how an operator goes back to the default: there is no number that means
 * "ask the default" (docs/adr/0005-allowances.md).
 */
export async function setAllowance(
  userId: string,
  tokensPerMonth: number | null,
): Promise<Loaded<Reading>> {
  const { data, error } = await foundry.api.admin.allowance({ userId }).put({ tokensPerMonth });
  if (error) {
    return { ok: false, message: why(error, 'Foundry would not change this allowance.') };
  }

  return { ok: true, value: readingOf(data) };
}

/**
 * The sentence Foundry answered with.
 *
 * A refusal arrives in the error envelope and a request the server could not read
 * arrives in Elysia's own shape; both carry a message, and `reasonFor` is what
 * knows how to read one — so this only finds it, rather than writing a second
 * reader for the same thing.
 */
function why(error: { value?: unknown }, fallback: string): string {
  const value = error.value as { error?: unknown; message?: unknown } | undefined;
  const said = (value?.error ?? value) as { message?: string; statusText?: string } | undefined;

  return reasonFor(said ?? null, fallback);
}

/**
 * A month as the console reads it.
 *
 * The parameter is written out rather than derived from the route, because this is
 * an adapter rather than a second copy of the wire: it names the fields the screen
 * draws and nothing else, so a field the server adds does not have to arrive here
 * to be ignored.
 */
function readingOf(reading: {
  allowance: number;
  used: number;
  warned: boolean;
  override: number | null;
  refusals: Refusal[];
}): Reading {
  return {
    allowance: reading.allowance,
    used: reading.used,
    warned: reading.warned,
    override: reading.override,
    refusals: reading.refusals,
  };
}
