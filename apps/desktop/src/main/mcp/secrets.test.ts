import { strict as assert } from 'node:assert';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../test-support/temp.ts';
import type { SecretKeeper } from '../auth/keys.ts';
import { mcpSecretStore, type McpServerCredentials } from './secrets.ts';

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

function directory(): string {
  return tempDir('kira-mcp-secrets-');
}

const CREDENTIALS: McpServerCredentials = {
  env: { API_TOKEN: 'env-secret' },
  headers: { 'x-api-key': 'header-secret' },
  bearerToken: 'bearer-secret',
};

interface Case {
  name: string;
  run(): Promise<void>;
}

const CASES: Case[] = [
  {
    name: 'seals credentials with an available OS keyring',
    async run() {
      const path = directory();
      const secrets = keyring();
      const store = mcpSecretStore({ secrets, path });
      await store.load();
      await store.update('server-1', CREDENTIALS);

      assert.deepEqual(store.read('server-1'), CREDENTIALS);
      assert.equal(store.has('server-1'), true);
      assert.equal(store.persisted('server-1'), true);
      const [file] = await readdir(path);
      assert.ok(file);
      const contents = await readFile(join(path, file), 'utf8');
      assert.equal(contents.includes('env-secret'), false);
      assert.equal(contents.includes('header-secret'), false);
      assert.equal(contents.includes('bearer-secret'), false);
      assert.equal((await stat(join(path, file))).mode & 0o777, 0o600);

      const reopened = mcpSecretStore({ secrets, path });
      await reopened.load();
      assert.deepEqual(reopened.read('server-1'), CREDENTIALS);
      assert.equal(reopened.persisted('server-1'), true);
    },
  },
  {
    name: 'reports encrypted credentials as unavailable when the keyring cannot open them',
    async run() {
      const path = directory();
      const writable = mcpSecretStore({ secrets: keyring(), path });
      await writable.load();
      await writable.update('server-1', CREDENTIALS);

      const unavailable = mcpSecretStore({
        secrets: keyring({ available: () => false }),
        path,
      });
      await unavailable.load();

      assert.equal(unavailable.read('server-1'), undefined);
      assert.equal(unavailable.has('server-1'), false);
      assert.equal(unavailable.persisted('server-1'), true);
    },
  },
  {
    name: 'keeps credentials in memory only when no OS keyring is available',
    async run() {
      const path = directory();
      const store = mcpSecretStore({ secrets: keyring({ available: () => false }), path });
      await store.load();
      await store.update('server-1', CREDENTIALS);

      assert.deepEqual(store.read('server-1'), CREDENTIALS);
      assert.equal(store.has('server-1'), true);
      assert.equal(store.persisted('server-1'), false);
      assert.deepEqual(await readdir(path), []);
    },
  },
  {
    name: 'replaces, partly clears, and forgets credentials',
    async run() {
      const path = directory();
      const store = mcpSecretStore({ secrets: keyring(), path });
      await store.load();
      await store.update('server-1', CREDENTIALS);
      await store.update('server-1', {
        env: { API_TOKEN: 'replacement' },
        bearerToken: null,
      });

      assert.deepEqual(store.read('server-1'), {
        env: { API_TOKEN: 'replacement' },
        headers: CREDENTIALS.headers,
      });
      assert.equal(store.has('server-1'), true);

      await store.forget('server-1');
      assert.equal(store.read('server-1'), undefined);
      assert.equal(store.has('server-1'), false);
      assert.deepEqual(await readdir(path), []);
    },
  },
  {
    name: 'does not expose replacement credentials before persistence completes',
    async run() {
      const path = directory();
      const ordinary = keyring();
      let calls = 0;
      let encryptionStarted!: () => void;
      let finishEncryption!: () => void;
      const started = new Promise<void>((resolve) => { encryptionStarted = resolve; });
      const waiting = new Promise<void>((resolve) => { finishEncryption = resolve; });
      const store = mcpSecretStore({
        secrets: keyring({
          encrypt: async (plaintext) => {
            calls++;
            if (calls === 2) {
              encryptionStarted();
              await waiting;
            }
            return ordinary.encrypt(plaintext);
          },
        }),
        path,
      });
      await store.load();
      await store.update('server-1', CREDENTIALS);

      const replacement = store.update('server-1', { bearerToken: 'replacement' });
      await started;
      assert.deepEqual(store.read('server-1'), CREDENTIALS);
      finishEncryption();
      await replacement;
      assert.deepEqual(store.read('server-1'), {
        ...CREDENTIALS,
        bearerToken: 'replacement',
      });
    },
  },
  {
    name: 'keeps unreadable encrypted credentials until they can be cleared or replaced safely',
    async run() {
      const path = directory();
      const writable = mcpSecretStore({ secrets: keyring(), path });
      await writable.load();
      await writable.update('server-1', { env: CREDENTIALS.env });
      const file = join(path, 'server-1.json');
      const saved = await readFile(file);

      const unavailable = mcpSecretStore({
        secrets: keyring({ available: () => false }),
        path,
      });
      await unavailable.load();
      await assert.rejects(
        unavailable.update('server-1', { env: { API_TOKEN: 'replacement' } }),
        /Saved MCP credentials are unavailable; clear them before replacing/u,
      );

      assert.deepEqual(await readFile(file), saved);
      assert.equal(unavailable.read('server-1'), undefined);
      assert.equal(unavailable.persisted('server-1'), true);

      await unavailable.update('server-1', { env: null });
      assert.equal(unavailable.has('server-1'), false);
      assert.equal(unavailable.persisted('server-1'), false);
      await assert.rejects(readFile(file), { code: 'ENOENT' });
    },
  },
  {
    name: 'stores OAuth registration, tokens, and PKCE verifier in a separate encrypted file',
    async run() {
      const path = directory();
      const store = mcpSecretStore({ secrets: keyring(), path });
      await store.load();
      await store.update('server-1', CREDENTIALS);
      const oauth = {
        clientInformation: {
          client_id: 'oauth-client-id',
          client_secret: 'oauth-client-secret',
          issuer: 'https://auth.example.test',
        },
        tokens: {
          access_token: 'oauth-access-token',
          refresh_token: 'oauth-refresh-token',
          token_type: 'Bearer',
          issuer: 'https://auth.example.test',
        },
        codeVerifier: 'pkce-verifier-secret',
      };

      await store.updateOAuth('server-1', oauth);

      const oauthFile = join(path, 'server-1.oauth.json');
      const contents = await readFile(oauthFile, 'utf8');
      for (const value of [
        'oauth-client-id',
        'oauth-client-secret',
        'oauth-access-token',
        'oauth-refresh-token',
        'pkce-verifier-secret',
      ]) assert.equal(contents.includes(value), false);
      assert.deepEqual(store.read('server-1'), CREDENTIALS);
      assert.deepEqual(store.readOAuth('server-1'), oauth);
      assert.equal(store.hasOAuth('server-1'), true);
      assert.equal(store.persistedOAuth('server-1'), true);

      const reopened = mcpSecretStore({ secrets: keyring(), path });
      await reopened.load();
      assert.deepEqual(reopened.read('server-1'), CREDENTIALS);
      assert.deepEqual(reopened.readOAuth('server-1'), oauth);
      assert.equal(reopened.persistedOAuth('server-1'), true);
      await reopened.clearOAuth('server-1');
      assert.equal(reopened.hasOAuth('server-1'), false);
      assert.equal(reopened.persistedOAuth('server-1'), false);
      assert.equal(reopened.read('server-1')?.bearerToken, CREDENTIALS.bearerToken);
    },
  },
  {
    name: 'preserves unreadable OAuth ciphertext until sign-out explicitly clears it',
    async run() {
      const path = directory();
      const writable = mcpSecretStore({ secrets: keyring(), path });
      await writable.load();
      await writable.updateOAuth('server-1', {
        clientInformation: { client_id: 'oauth-client-id', redirect_uris: [] },
        tokens: { access_token: 'oauth-access-token', token_type: 'Bearer' },
      });
      const file = join(path, 'server-1.oauth.json');
      const saved = await readFile(file);

      const unavailable = mcpSecretStore({
        secrets: keyring({ available: () => false }),
        path,
      });
      await unavailable.load();
      assert.equal(unavailable.hasOAuth('server-1'), false);
      assert.equal(unavailable.persistedOAuth('server-1'), true);
      await assert.rejects(
        unavailable.updateOAuth('server-1', { tokens: null }),
        /Saved MCP OAuth credentials are unavailable; clear them before replacing/u,
      );
      assert.deepEqual(await readFile(file), saved);

      await unavailable.clearOAuth('server-1');
      assert.equal(unavailable.persistedOAuth('server-1'), false);
      await assert.rejects(readFile(file), { code: 'ENOENT' });
    },
  },
  {
    name: 'refuses OAuth persistence without OS-backed encryption',
    async run() {
      const path = directory();
      const store = mcpSecretStore({ secrets: keyring({ available: () => false }), path });
      await store.load();

      await assert.rejects(
        store.updateOAuth('server-1', { codeVerifier: 'must-not-be-written' }),
        /OAuth credentials require OS-backed encrypted storage/u,
      );
      assert.equal(store.readOAuth('server-1'), undefined);
      assert.deepEqual(await readdir(path), []);
    },
  },
  {
    name: 'preserves the last saved values when a credential write fails',
    async run() {
      const path = directory();
      const secrets = keyring();
      const store = mcpSecretStore({ secrets, path });
      await store.load();
      await store.update('server-1', CREDENTIALS);

      const failing = mcpSecretStore({
        secrets: keyring({ encrypt: async () => { throw new Error('keyring unavailable'); } }),
        path,
      });
      await failing.load();
      await assert.rejects(
        failing.update('server-1', { bearerToken: 'replacement' }),
        /keyring unavailable/,
      );

      assert.deepEqual(failing.read('server-1'), CREDENTIALS);
      assert.equal(failing.has('server-1'), true);
      const reopened = mcpSecretStore({ secrets, path });
      await reopened.load();
      assert.deepEqual(reopened.read('server-1'), CREDENTIALS);
    },
  },
];

test('MCP secret storage handles persistence and credential changes', async (context) => {
  for (const testCase of CASES) {
    await context.test(testCase.name, testCase.run);
  }
});
