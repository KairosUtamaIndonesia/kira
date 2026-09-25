/**
 * What a read from the server answers with. A failure comes back as a value
 * rather than thrown, the way the desktop's bridge reports one: a console that
 * cannot reach its server has a sentence to draw, and a page does not go blank
 * because a request answered 403.
 */
export type Loaded<T> = { ok: true; value: T } | { ok: false; message: string };

/** Barely-typed, because the client's own error type is structural and loose. */
interface Failure {
  message?: string;
  statusText?: string;
}

/**
 * The sentence to show for a failure. The client's messages are already written
 * for a person ("Invalid origin"), so they are passed through rather than
 * replaced with something Kira made up.
 */
export function reasonFor(error: Failure | null, fallback: string): string {
  return error?.message ?? error?.statusText ?? fallback;
}
