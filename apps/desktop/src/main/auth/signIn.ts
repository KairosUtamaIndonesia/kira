/**
 * Signing in, and who is signed in.
 *
 * The app signs in through the system browser: this side opens it, the user
 * signs in there, and the answer comes back as a one-time token on a deep link
 * that this side trades for a key of its own. Everything the journey needs from
 * outside — the browser, the server, the disk — is handed in rather than
 * reached for, so the whole thing can be walked in a test without a window, a
 * network or a keyring.
 */
import type { AuthState, AuthUser, MemoryChoice } from '../../preload/bridge.ts';
import type { CatalogAnswer } from '../pi/models.ts';
import type { MemoryAnswer } from '../memory.ts';
import type { TrackerWire } from '../tracker.ts';
import type { WorkerWire } from '../worker.ts';
import type { UsageAnswer } from '../usage.ts';
import type { KeyStore } from './keys.ts';

/**
 * What the server says about a key this device holds.
 *
 * Three answers rather than two, because they call for three different things.
 * A key the server honours is the person who signed in; a key it has stopped
 * honouring is a key that will never work again and is worth throwing away; and
 * a server that could not be asked is neither, so the key is kept
 * (docs/adr/0006-key-storage.md).
 */
export type KeyVerdict =
  | { kind: 'ok'; user: AuthUser }
  | { kind: 'refused' }
  | { kind: 'unreachable' };

/**
 * Where the sign-in hand-off lands, and what the app is listening for.
 *
 * Fixed by the pair that build it: the client redirects the browser to
 * `<scheme>:` + this path, and the server builds the same redirect from its own
 * side. The setting is passed to the client rather than left to its default, so
 * that this constant is the only place the shape is stated here.
 */
export const RETURN_PATH = '/auth/callback';

/**
 * The one-time token out of a deep link, or null when the link is not the
 * hand-off this app is waiting for.
 *
 * A link that is not addressed to this app, or is not on the path sign-in comes
 * back through, is not a sign-in — so it is refused rather than followed, and
 * whatever else the operating system decides to send here is ignored.
 */
export function handoffToken(link: string, scheme: string): string | null {
  const url = URL.parse(link);
  if (url?.protocol !== `${scheme}:`) return null;
  if (`/${url.hostname}${url.pathname}` !== RETURN_PATH) return null;
  if (!url.hash.startsWith('#token=')) return null;

  return decodeURIComponent(url.hash.slice('#token='.length));
}

/** The Foundry server, as the desktop uses it. */
export interface Foundry extends TrackerWire, WorkerWire {
  /** Open the system browser at the server's sign-in entry point. */
  openSignIn(): Promise<void>;
  /** Trade a deep link's token for a session, answering who signed in. */
  claim(token: string): Promise<AuthUser>;
  /** Retire the keys this device already holds, so signing in replaces one. */
  retireDeviceKeys(device: string): Promise<void>;
  /** Mint a key for this device, under the session just established. */
  mintKey(device: string): Promise<string>;
  /** What the server says about a key this device holds. */
  check(key: string): Promise<KeyVerdict>;
  /** What the server can serve, or that it could not say. */
  catalog(key: string): Promise<CatalogAnswer>;
  /** What this person has used this month, or that the server could not say. */
  usage(key: string): Promise<UsageAnswer>;
  /** What this person decided about memory, or that the server could not say. */
  memory(key: string): Promise<MemoryAnswer>;
  /** Write a change to those settings down, or say why the server would not. */
  saveMemory(key: string, decided: MemoryChoice): Promise<MemoryAnswer>;
  /** End the session, leaving only the key. */
  endSession(): Promise<void>;
}
export interface SignInDeps {
  keys: KeyStore;
  foundry: Foundry;
  /** What this machine is called, which is what its key is named for. */
  device: string;
  /** Told whenever who is signed in changes, so the window can be told too. */
  onChange(state: AuthState): void;
}

export interface SignIn {
  /** Whether anyone is signed in, and who, as the server last confirmed it. */
  current(): Promise<AuthState>;
  /** Open the system browser. What came of it arrives through `onChange`. */
  begin(): Promise<void>;
  /** The deep link arrived: trade its token for this device's key. */
  finish(token: string): Promise<void>;
  /** Forget this device's key and end its session; answers the state left behind. */
  signOut(): Promise<AuthState>;
}

export function signIn({ keys, foundry, device, onChange }: SignInDeps): SignIn {
  return {
    async current() {
      const stored = await keys.read();
      if (stored === null) return signedOut();

      const verdict = await foundry.check(stored.key);
      if (verdict.kind === 'refused') {
        // The server has stopped honouring this key, so the machine should stop
        // holding it: asking again on the next launch would only fail again.
        await keys.forget();
        return signedOut();
      }

      // Unreachable is not refused. A server that could not be asked has said
      // nothing, and forgetting on a blip would sign out everyone on a train,
      // so what was remembered is shown instead.
      return signedIn(verdict.kind === 'ok' ? verdict.user : stored.user);
    },

    async begin() {
      await foundry.openSignIn();
    },

    async finish(token) {
      const user = await foundry.claim(token);

      // One key per install (docs/adr/0006-key-storage.md): signing in again
      // replaces the key this machine already had rather than leaving another
      // live one beside it. It matters most where the key cannot be kept — a
      // machine with no keyring signs in on every launch, and would otherwise
      // mint a key each time.
      await foundry.retireDeviceKeys(device);
      const key = await foundry.mintKey(device);
      await keys.write({ key, user });

      // The key is what this machine proves itself with, and the session was
      // only how it was obtained. Keeping both would leave a second way in with
      // a lifetime nobody asked for (docs/adr/0004-sign-in.md).
      //
      // A session that cannot be ended does not undo a key that has already been
      // issued, so it is not an error here — and the key is announced either way.
      await foundry.endSession().catch(() => {});

      onChange(signedIn(user));
    },

    async signOut() {
      // The local half goes first, and cannot fail: a key this device no longer
      // holds is the part that matters.
      await keys.forget();
      const state = signedOut();
      onChange(state);

      // The server session is ended too, so a later sign-in does not carry this
      // one's cookie. Not reaching the server does not undo the key being gone,
      // so it is not an error here.
      await foundry.endSession().catch(() => {});

      return state;
    },
  };
}

const signedOut = (): AuthState => ({ signedIn: false });
const signedIn = (user: AuthUser): AuthState => ({ signedIn: true, user });
