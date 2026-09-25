/**
 * The Foundry key at rest.
 *
 * One small file, holding ciphertext and nothing else, plus the memory that
 * stands in for it on a machine with no keyring to encrypt with. Every way the
 * file can fail to be readable — never written, half written, written under a
 * different keyring, decrypted into nonsense — is answered the same way, which
 * is that this device is not signed in. None of them is a crash
 * (docs/adr/0006-key-storage.md).
 */
import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAuthUser, type AuthUser } from '../../preload/bridge.ts';

/** The file's own format, so a later one can be told from this one. */
const VERSION = 1;

/**
 * What the operating system can do with a secret.
 *
 * Narrow on purpose: this is the whole of what the store needs from Electron's
 * `safeStorage`, so it can be exercised without a window. Deciding whether the
 * encryption is real is the caller's job, because the check that fails closed
 * is a synchronous one and the round trip is not.
 */
export interface SecretKeeper {
  /** Whether a real keyring is behind this, by the check that fails closed. */
  available(): boolean;
  /** Which keyring answered: a file written under another one is not this app's. */
  backend(): string;
  encrypt(plaintext: string): Promise<Buffer>;
  decrypt(ciphertext: Buffer): Promise<string>;
}

/** A device's Foundry key, with the person it was issued to. */
export interface StoredKey {
  key: string;
  user: AuthUser;
}

export interface KeyStore {
  read(): Promise<StoredKey | null>;
  write(stored: StoredKey): Promise<void>;
  forget(): Promise<void>;
}

/** The file, as distinct from what is sealed inside it. */
interface Sealed {
  version: number;
  backend: string;
  sealed: string;
}

/**
 * A key store over one file.
 *
 * The keyring and the path are handed in rather than reached for, which is what
 * lets a test write to a directory of its own with a keyring that answers
 * whatever the case is about — including the one that matters most, a machine
 * with no keyring at all.
 */
export function keyStore({ secrets, path }: { secrets: SecretKeeper; path: string }): KeyStore {
  // Where the key lives when there is nowhere to put it. A machine with no
  // keyring still signs in; the key simply does not outlive the process, which
  // is the accepted cost of never writing one in the clear.
  let held: StoredKey | null = null;

  return {
    async read() {
      // A file that will not open is left exactly where it is. A keyring that is
      // locked this morning is not a key that is gone, and the next launch is
      // allowed to open it.
      held ??= await unseal();
      return held;
    },

    async write(stored) {
      held = stored;
      // No keyring means no file — not a plaintext one, and not one pretending
      // to be encrypted with a key anybody can reproduce.
      if (!secrets.available()) return;
      await seal(stored);
    },

    async forget() {
      held = null;
      await rm(path, { force: true });
    },
  };

  /** What the file holds, or nothing, for every way it can hold nothing. */
  async function unseal(): Promise<StoredKey | null> {
    try {
      const file = JSON.parse(await readFile(path, 'utf8')) as Partial<Sealed>;
      if (file.version !== VERSION || file.backend !== secrets.backend()) return null;
      if (typeof file.sealed !== 'string') return null;

      const opened = await secrets.decrypt(Buffer.from(file.sealed, 'base64'));
      const stored = JSON.parse(opened) as Partial<StoredKey>;
      if (typeof stored.key !== 'string' || !isAuthUser(stored.user)) return null;

      return { key: stored.key, user: stored.user };
    } catch {
      return null;
    }
  }

  async function seal(stored: StoredKey): Promise<void> {
    const file: Sealed = {
      version: VERSION,
      backend: secrets.backend(),
      sealed: (await secrets.encrypt(JSON.stringify(stored))).toString('base64'),
    };

    // Written beside itself and then moved into place, so a process that dies
    // mid-write leaves the key it had or the key it was given, never half of
    // either. 0600 because the ciphertext is still the thing worth guarding.
    const writing = `${path}.${randomUUID()}`;
    await writeFile(writing, JSON.stringify(file), { mode: 0o600 });
    await rename(writing, path);
  }
}
