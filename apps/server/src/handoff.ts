/**
 * The shape of the hand-off that returns a signed-in user to the desktop app.
 *
 * One home for the three things both ends have to agree on: the scheme the app
 * is registered under, the path the browser sends it to, and the cookie the
 * sign-in callback leaves the one-time token in. It is deliberately not an
 * environment setting — the app states the scheme and the path again on its own
 * side, and a value that only ever has one correct answer is a value that can
 * only ever be set wrong.
 *
 * @see apps/desktop/src/main/index.ts for the scheme the app claims, and
 * `apps/desktop/src/main/auth/signIn.ts` for the path it listens on.
 */

/**
 * The app's own id, the other way round, which is how a custom protocol is
 * named so that no other application can claim it.
 */
export const DESKTOP_SCHEME = 'ai.kira.kairos';

/**
 * The path the app is handed its token on. This is `@better-auth/electron`'s
 * default `callbackPath`, and the app sets the same value on its client.
 */
const RETURN_PATH = '/auth/callback';

/**
 * The cookie the sign-in callback leaves the hand-off token in. Its name is the
 * plugin's own default — `<cookiePrefix>.<clientID>` — and it is deliberately
 * not `httpOnly`, which is what lets the token be read on the way past.
 */
const HANDOFF_COOKIE = 'better-auth.electron';

/**
 * The hand-off token out of a request's cookies, or null when it carries none.
 *
 * The value goes on untouched: it is a base64url blob the app decodes itself,
 * and the cookie arrives percent-encoded, which is the shape it expects.
 */
export function handoffToken(cookieHeader: string | null): string | null {
  for (const cookie of cookieHeader?.split(';') ?? []) {
    const [name, ...value] = cookie.trim().split('=');
    if (name === HANDOFF_COOKIE) return value.join('=') || null;
  }

  return null;
}

/**
 * Where the browser is sent so the operating system hands the app its token.
 *
 * The double slash is the client's, not a typo: it addresses the app as
 * `<scheme>:` plus `/auth/callback`, and the app reads the path back the same
 * way — as a host of `auth` and a path of `/callback`.
 */
export function handoffLink(token: string): string {
  return `${DESKTOP_SCHEME}:/${RETURN_PATH}#token=${token}`;
}
