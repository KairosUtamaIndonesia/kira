/**
 * The auth channels' handlers.
 *
 * What the window may ask about signing in, and nothing more: whether anyone is
 * signed in, who they are, and the two things it may do about it. No key, and
 * no way to read one, is among them — the credential stays on this side of the
 * seam, so there is no handler here that could hand one over.
 */
import { AUTH_CHANNELS, type AuthState, type Result } from '../../preload/bridge.ts';
import { envelope, nothing } from './result.ts';

export { AUTH_CHANNELS };

/** What the handlers need from the main process. */
export interface AuthDeps {
  /** Who is signed in, as the server last confirmed it. */
  current(): Promise<AuthState>;
  /** Open the system browser. What came of it arrives as an event, not here. */
  begin(): Promise<void>;
  /** Forget this device's key and end its session; answers the state left behind. */
  signOut(): Promise<AuthState>;
}

export interface AuthHandlers {
  load(): Promise<Result<AuthState>>;
  signIn(): Promise<Result<null>>;
  signOut(): Promise<Result<AuthState>>;
}

export function authHandlers({ current, begin, signOut }: AuthDeps): AuthHandlers {
  return {
    load: () => envelope(current),
    signIn: () => nothing(begin),
    signOut: () => envelope(signOut),
  };
}
