import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from '@modelcontextprotocol/client';
import type { SecretKeeper } from '../auth/keys.ts';

const VERSION = 1;
const SERVER_ID = /^[a-z0-9-]{1,128}$/iu;

export interface McpServerCredentials {
  env?: Record<string, string>;
  headers?: Record<string, string>;
  bearerToken?: string;
}

export interface McpOAuthCredentials {
  clientInformation?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
}

export type McpOAuthChange = {
  [K in keyof McpOAuthCredentials]?: McpOAuthCredentials[K] | null;
};

/** An omitted field keeps its current value; null explicitly clears that field. */
export interface McpCredentialsChange {
  env?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  bearerToken?: string | null;
}

interface Sealed {
  version: number;
  backend: string;
  sealed: string;
}

export interface McpSecretSnapshot {
  credentials: McpServerCredentials | undefined;
  oauth: McpOAuthCredentials | undefined;
  sealedFile: Buffer | undefined;
  sealedOAuthFile: Buffer | undefined;
}

export interface McpSecretStore {
  load(): Promise<void>;
  snapshot(serverId: string): Promise<McpSecretSnapshot>;
  restore(serverId: string, snapshot: McpSecretSnapshot): Promise<void>;
  read(serverId: string): McpServerCredentials | undefined;
  has(serverId: string): boolean;
  persisted(serverId: string): boolean;
  update(serverId: string, change: McpCredentialsChange): Promise<void>;
  readOAuth(serverId: string): McpOAuthCredentials | undefined;
  hasOAuth(serverId: string): boolean;
  persistedOAuth(serverId: string): boolean;
  updateOAuth(serverId: string, change: McpOAuthChange): Promise<void>;
  clearOAuth(serverId: string): Promise<void>;
  forget(serverId: string): Promise<void>;
}

/** One safeStorage-sealed file per MCP server, kept outside SQLite. */
export function mcpSecretStore({ secrets, path }: { secrets: SecretKeeper; path: string }): McpSecretStore {
  const credentials = new Map<string, McpServerCredentials>();
  const persisted = new Set<string>();
  const oauth = new Map<string, McpOAuthCredentials>();
  const persistedOAuth = new Set<string>();
  let loaded: Promise<void> | undefined;
  let writes = Promise.resolve();

  function fileFor(serverId: string): string {
    if (!SERVER_ID.test(serverId)) throw new Error('That MCP server does not exist.');
    return join(path, `${serverId}.json`);
  }

  function oauthFileFor(serverId: string): string {
    if (!SERVER_ID.test(serverId)) throw new Error('That MCP server does not exist.');
    return join(path, `${serverId}.oauth.json`);
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const current = writes.then(operation);
    writes = current.then(() => undefined, () => undefined);
    return current;
  }

  function copy(value: McpServerCredentials | undefined): McpServerCredentials | undefined {
    if (value === undefined) return undefined;
    return {
      ...(value.env === undefined ? {} : { env: { ...value.env } }),
      ...(value.headers === undefined ? {} : { headers: { ...value.headers } }),
      ...(value.bearerToken === undefined ? {} : { bearerToken: value.bearerToken }),
    };
  }

  function copyOAuth(value: McpOAuthCredentials | undefined): McpOAuthCredentials | undefined {
    return value === undefined ? undefined : structuredClone(value);
  }

  async function writeSealed(file: string, value: unknown): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const sealed: Sealed = {
      version: VERSION,
      backend: secrets.backend(),
      sealed: (await secrets.encrypt(JSON.stringify(value))).toString('base64'),
    };
    const writing = `${file}.${randomUUID()}`;
    try {
      await writeFile(writing, JSON.stringify(sealed), { mode: 0o600 });
      await rename(writing, file);
    } finally {
      await rm(writing, { force: true });
    }
  }

  async function readSealed(file: string): Promise<unknown | null> {
    const stored = JSON.parse(await readFile(file, 'utf8')) as Partial<Sealed>;
    if (
      stored.version !== VERSION
      || stored.backend !== secrets.backend()
      || typeof stored.sealed !== 'string'
      || !secrets.available()
    ) return null;

    return JSON.parse(await secrets.decrypt(Buffer.from(stored.sealed, 'base64')));
  }

  async function persist(serverId: string, value: McpServerCredentials | undefined): Promise<boolean> {
    const file = fileFor(serverId);
    if (value === undefined || Object.keys(value).length === 0) {
      await rm(file, { force: true });
      return false;
    }

    if (!secrets.available()) {
      // Keep values for this process, but never write an unsealed fallback or
      // remove an encrypted value that this device cannot currently open.
      return false;
    }

    await writeSealed(file, value);
    return true;
  }

  async function open(file: string, serverId: string): Promise<void> {
    try {
      const valid = credentialsIn(await readSealed(file));
      if (valid !== null && Object.keys(valid).length > 0) credentials.set(serverId, valid);
    } catch {
      // An unreadable file is not a reason to stop the app or overwrite it.
    }
  }

  async function openOAuth(file: string, serverId: string): Promise<void> {
    try {
      const valid = oauthIn(await readSealed(file));
      if (valid !== null && Object.keys(valid).length > 0) oauth.set(serverId, valid);
    } catch {
      // An unreadable file is not a reason to stop the app or overwrite it.
    }
  }

  async function persistOAuth(serverId: string, value: McpOAuthCredentials | undefined): Promise<void> {
    const file = oauthFileFor(serverId);
    if (value === undefined || Object.keys(value).length === 0) {
      await rm(file, { force: true });
      return;
    }
    if (!secrets.available()) {
      throw new Error('OAuth credentials require OS-backed encrypted storage.');
    }

    await writeSealed(file, value);
  }

  return {
    async load() {
      loaded ??= (async () => {
        let files: string[];
        try {
          files = await readdir(path);
        } catch {
          return;
        }
        for (const name of files) {
          if (name.endsWith('.oauth.json')) {
            const serverId = name.slice(0, -'.oauth.json'.length);
            if (!SERVER_ID.test(serverId)) continue;
            persistedOAuth.add(serverId);
            await openOAuth(join(path, name), serverId);
          } else if (name.endsWith('.json')) {
            const serverId = name.slice(0, -'.json'.length);
            if (!SERVER_ID.test(serverId)) continue;
            persisted.add(serverId);
            await open(join(path, name), serverId);
          }
        }
      })();
      await loaded;
    },

    snapshot(serverId) {
      return enqueue(async () => {
        const file = fileFor(serverId);
        const oauthFile = oauthFileFor(serverId);
        let sealedFile: Buffer | undefined;
        let sealedOAuthFile: Buffer | undefined;
        try {
          sealedFile = await readFile(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        try {
          sealedOAuthFile = await readFile(oauthFile);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        return {
          credentials: copy(credentials.get(serverId)),
          oauth: copyOAuth(oauth.get(serverId)),
          sealedFile,
          sealedOAuthFile,
        };
      });
    },

    restore(serverId, snapshot) {
      return enqueue(async () => {
        for (const [file, sealedFile] of [
          [fileFor(serverId), snapshot.sealedFile],
          [oauthFileFor(serverId), snapshot.sealedOAuthFile],
        ] as const) {
          if (sealedFile === undefined) {
            await rm(file, { force: true });
          } else {
            await mkdir(path, { recursive: true, mode: 0o700 });
            const writing = `${file}.${randomUUID()}`;
            try {
              await writeFile(writing, sealedFile, { mode: 0o600 });
              await rename(writing, file);
            } finally {
              await rm(writing, { force: true });
            }
          }
        }
        const value = copy(snapshot.credentials);
        if (value === undefined) credentials.delete(serverId);
        else credentials.set(serverId, value);
        if (snapshot.sealedFile === undefined) persisted.delete(serverId);
        else persisted.add(serverId);
        const oauthValue = copyOAuth(snapshot.oauth);
        if (oauthValue === undefined) oauth.delete(serverId);
        else oauth.set(serverId, oauthValue);
        if (snapshot.sealedOAuthFile === undefined) persistedOAuth.delete(serverId);
        else persistedOAuth.add(serverId);
      });
    },

    read(serverId) {
      return copy(credentials.get(serverId));
    },

    has(serverId) {
      return credentials.has(serverId);
    },

    persisted(serverId) {
      return persisted.has(serverId);
    },

    readOAuth(serverId) {
      return copyOAuth(oauth.get(serverId));
    },

    hasOAuth(serverId) {
      return oauth.get(serverId)?.tokens !== undefined;
    },

    persistedOAuth(serverId) {
      return persistedOAuth.has(serverId);
    },

    updateOAuth(serverId, change) {
      return enqueue(async () => {
        const previous = copyOAuth(oauth.get(serverId));
        const next = previous ?? {};
        for (const key of ['clientInformation', 'tokens', 'codeVerifier', 'discoveryState'] as const) {
          const value = change[key];
          if (value === undefined) continue;
          if (value === null) delete next[key];
          else next[key] = structuredClone(value) as never;
        }
        const value = Object.keys(next).length === 0 ? undefined : next;
        if (persistedOAuth.has(serverId) && previous === undefined) {
          throw new Error('Saved MCP OAuth credentials are unavailable; clear them before replacing.');
        }
        await persistOAuth(serverId, value);
        if (value === undefined) oauth.delete(serverId);
        else oauth.set(serverId, value);
        if (value === undefined) persistedOAuth.delete(serverId);
        else persistedOAuth.add(serverId);
      });
    },

    clearOAuth(serverId) {
      return enqueue(async () => {
        await rm(oauthFileFor(serverId), { force: true });
        oauth.delete(serverId);
        persistedOAuth.delete(serverId);
      });
    },

    update(serverId, change) {
      return enqueue(async () => {
        const previous = copy(credentials.get(serverId));
        const next = copy(previous) ?? {};
        for (const key of ['env', 'headers'] as const) {
          const value = change[key];
          if (value === undefined) continue;
          if (value === null || Object.keys(value).length === 0) delete next[key];
          else next[key] = { ...value };
        }
        if (change.bearerToken !== undefined) {
          if (change.bearerToken === null || change.bearerToken === '') delete next.bearerToken;
          else next.bearerToken = change.bearerToken;
        }
        const value = Object.keys(next).length === 0 ? undefined : next;
        if (value !== undefined && persisted.has(serverId) && (!secrets.available() || previous === undefined)) {
          throw new Error('Saved MCP credentials are unavailable; clear them before replacing');
        }
        const isPersisted = await persist(serverId, value);
        if (value === undefined) credentials.delete(serverId);
        else credentials.set(serverId, value);
        if (isPersisted) persisted.add(serverId);
        else persisted.delete(serverId);
      });
    },

    forget(serverId) {
      return enqueue(async () => {
        await Promise.all([
          rm(fileFor(serverId), { force: true }),
          rm(oauthFileFor(serverId), { force: true }),
        ]);
        credentials.delete(serverId);
        persisted.delete(serverId);
        oauth.delete(serverId);
        persistedOAuth.delete(serverId);
      });
    },
  };
}

function oauthIn(value: unknown): McpOAuthCredentials | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const asked = value as Record<string, unknown>;
  const result: McpOAuthCredentials = {};

  if (asked.clientInformation !== undefined) {
    const client = asked.clientInformation;
    if (typeof client !== 'object' || client === null || Array.isArray(client)) return null;
    if (typeof (client as Record<string, unknown>).client_id !== 'string') return null;
    result.clientInformation = client as StoredOAuthClientInformation;
  }
  if (asked.tokens !== undefined) {
    const tokens = asked.tokens;
    if (typeof tokens !== 'object' || tokens === null || Array.isArray(tokens)) return null;
    const fields = tokens as Record<string, unknown>;
    if (typeof fields.access_token !== 'string' || typeof fields.token_type !== 'string') return null;
    result.tokens = tokens as StoredOAuthTokens;
  }
  if (asked.codeVerifier !== undefined) {
    if (typeof asked.codeVerifier !== 'string') return null;
    result.codeVerifier = asked.codeVerifier;
  }
  if (asked.discoveryState !== undefined) {
    const state = asked.discoveryState;
    if (typeof state !== 'object' || state === null || Array.isArray(state)) return null;
    if (typeof (state as Record<string, unknown>).authorizationServerUrl !== 'string') return null;
    result.discoveryState = state as OAuthDiscoveryState;
  }
  return result;
}

function credentialsIn(value: unknown): McpServerCredentials | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const asked = value as Record<string, unknown>;
  const result: McpServerCredentials = {};
  for (const key of ['env', 'headers'] as const) {
    const record = asked[key];
    if (record === undefined) continue;
    if (typeof record !== 'object' || record === null || Array.isArray(record)) return null;
    const entries = Object.entries(record);
    if (!entries.every(([name, secret]) => name.length > 0 && typeof secret === 'string')) return null;
    if (entries.length > 0) result[key] = Object.fromEntries(entries);
  }
  if (asked.bearerToken !== undefined) {
    if (typeof asked.bearerToken !== 'string') return null;
    if (asked.bearerToken !== '') result.bearerToken = asked.bearerToken;
  }
  return result;
}
