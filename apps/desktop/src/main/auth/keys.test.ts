import { strict as assert } from 'node:assert';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../test-support/temp.ts';
import { keyStore, type SecretKeeper, type StoredKey } from './keys.ts';

const ADA: StoredKey = {
  key: 'vdudvQbXhxOhjazQtHaLjjyrpfaWCMRxkONcOwfblujBxxzqpeVz',
  user: { name: 'Ada Lovelace', email: 'ada@company.example' },
};

/**
 * A stand-in for a keyring that is obviously not one.
 *
 * What it hands back is not the plaintext, so a test can tell a sealed file
 * from an open one, and it comes back unchanged, so a round trip can be told
 * from a coincidence. `key` is what a different machine's keyring would differ
 * by, which is how "written somewhere else" is expressed.
 */
function keyring({ key = 0x5a, ...overrides }: Partial<SecretKeeper> & { key?: number } = {}) {
  const flip = (bytes: Buffer) => Buffer.from([...bytes].map((byte) => byte ^ key));

  return {
    available: () => true,
    backend: () => 'gnome_libsecret',
    encrypt: async (plaintext: string) => flip(Buffer.from(plaintext, 'utf8')),
    decrypt: async (ciphertext: Buffer) => flip(ciphertext).toString('utf8'),
    ...overrides,
  } satisfies SecretKeeper;
}

/** A path in a directory of its own, which is the whole of what the store needs. */
function tempPath(): string {
  return join(tempDir('kira-key-'), 'key.json');
}

/** What is in the file before the store is opened. */
type Before = (secrets: SecretKeeper, path: string) => Promise<void>;

const nothing: Before = async () => {};

/** The file as the store writes it, with the parts a case is about replaced. */
const written = (
  payload: unknown = ADA,
  file: Record<string, unknown> = {},
  writer?: SecretKeeper,
): Before => {
  return async (secrets, path) => {
    const sealing = writer ?? secrets;
    const sealed = (await sealing.encrypt(JSON.stringify(payload))).toString('base64');
    await writeFile(
      path,
      JSON.stringify({ version: 1, backend: sealing.backend(), sealed, ...file }),
    );
  };
};

/** Bytes that are not the store's file at all. */
const bytes = (contents: string): Before => {
  return async (_secrets, path) => {
    await writeFile(path, contents);
  };
};

interface Case {
  name: string;
  secrets?: Partial<SecretKeeper> & { key?: number };
  before: Before;
  want: StoredKey | null;
}

const CASES: Case[] = [
  { name: 'nothing has been written yet', before: nothing, want: null },
  { name: 'a key this keyring wrote', before: written(), want: ADA },
  {
    name: 'a key written in the open, with no sealing at all',
    before: bytes(JSON.stringify(ADA)),
    want: null,
  },
  {
    name: 'a file from a format this build does not know',
    before: written(ADA, { version: 2 }),
    want: null,
  },
  {
    name: 'a key written under a different keyring',
    before: written(ADA, { backend: 'kwallet6' }),
    want: null,
  },
  {
    name: 'ciphertext this keyring cannot open',
    before: written(ADA, {}, keyring({ key: 0x33 })),
    want: null,
  },
  { name: 'a file that is not JSON', before: bytes('not json at all'), want: null },
  { name: 'a file that is only half a file', before: bytes('{}'), want: null },
  {
    name: 'a file whose ciphertext is not a string',
    before: written(ADA, { sealed: 42 }),
    want: null,
  },
  {
    name: 'a key that opens into something else entirely',
    before: written({ opened: 'but not a key' }),
    want: null,
  },
  {
    name: 'a key with nobody named on it',
    before: written({ key: ADA.key, user: { name: 'Ada Lovelace' } }),
    want: null,
  },
];

for (const testCase of CASES) {
  test(testCase.name, async () => {
    const secrets = keyring(testCase.secrets);
    const path = tempPath();
    await testCase.before(secrets, path);

    assert.deepEqual(await keyStore({ secrets, path }).read(), testCase.want);
  });
}

test('the file holds no key material in the open', async () => {
  const secrets = keyring();
  const path = tempPath();

  await keyStore({ secrets, path }).write(ADA);

  const contents = await readFile(path, 'utf8');
  assert.equal(contents.includes(ADA.key), false);
  assert.equal(contents.includes(ADA.user.email), false);
});

test('the file is written for its owner alone', async () => {
  const secrets = keyring();
  const path = tempPath();

  await keyStore({ secrets, path }).write(ADA);

  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('a machine with no keyring writes no file at all', async () => {
  const secrets = keyring({ available: () => false });
  const path = tempPath();
  const keys = keyStore({ secrets, path });

  await keys.write(ADA);

  await assert.rejects(readFile(path, 'utf8'), 'nothing was written');
  // Held for the session instead, so signing in still works — it just does not
  // survive the process, which is the cost of never writing a key in the clear.
  assert.deepEqual(await keys.read(), ADA);
});

test('a machine that has lost its keyring reads nothing', async () => {
  const path = tempPath();
  await keyStore({ secrets: keyring(), path }).write(ADA);

  // A machine with no keyring is one whose backend is the fallback, not the
  // keyring the file was written under — which is what makes the file unreadable
  // rather than merely old.
  const bare = keyring({ available: () => false, backend: () => 'basic_text' });

  assert.equal(await keyStore({ secrets: bare, path }).read(), null);
});

test('a second launch starts signed in', async () => {
  const secrets = keyring();
  const path = tempPath();
  await keyStore({ secrets, path }).write(ADA);

  assert.deepEqual(await keyStore({ secrets, path }).read(), ADA);
});

test('forgetting takes the key off the disk and out of the session', async () => {
  const secrets = keyring();
  const path = tempPath();
  const keys = keyStore({ secrets, path });
  await keys.write(ADA);

  await keys.forget();

  await assert.rejects(readFile(path, 'utf8'), 'the file is gone');
  assert.equal(await keys.read(), null);
});
