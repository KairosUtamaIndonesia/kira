/**
 * The Git host channels' handlers.
 *
 * A connection is server-wide, and connecting or disconnecting one is an
 * administrator's act. The check is not invented here: the server refuses a
 * person who is not an administrator in its own words, and that sentence is what
 * reaches the window (docs/adr/0026).
 */
import {
  type GitConnection,
  type GitConnectionCreated,
  type GitConnectionInput,
  type GitHubConnect,
  GIT_CHANNELS,
  type InstallationRepository,
  type Result,
} from '../../preload/bridge.ts';
import { envelope } from './result.ts';

export { GIT_CHANNELS };

/** The hosts a connection may name. */
const PROVIDERS = ['github', 'forgejo', 'gitea', 'gitlab'];

export interface GitDeps {
  connections(): Promise<GitConnection[]>;
  connect(input: GitConnectionInput): Promise<GitConnectionCreated>;
  disconnect(id: string): Promise<null>;
  githubConnect(): Promise<GitHubConnect>;
  connectionRepositories(id: string): Promise<InstallationRepository[]>;
}

export interface GitHandlers {
  connections(): Promise<Result<GitConnection[]>>;
  connect(input: unknown): Promise<Result<GitConnectionCreated>>;
  disconnect(id: unknown): Promise<Result<null>>;
  githubConnect(): Promise<Result<GitHubConnect>>;
  connectionRepositories(id: unknown): Promise<Result<InstallationRepository[]>>;
}

export function gitHandlers({
  connections,
  connect,
  disconnect,
  githubConnect,
  connectionRepositories,
}: GitDeps): GitHandlers {
  return {
    connections: () => envelope(() => connections()),

    githubConnect: () => envelope(() => githubConnect()),

    connectionRepositories: (id) => {
      if (typeof id !== 'string' || id === '') {
        return Promise.resolve({
          ok: false,
          error: 'A host needs an id to list its repositories.',
        });
      }

      return envelope(() => connectionRepositories(id));
    },

    connect: (input) => {
      const asked = connectionIn(input);
      if (asked === null) {
        return Promise.resolve({ ok: false, error: 'That is not a host to connect.' });
      }

      return envelope(() => connect(asked));
    },

    disconnect: (id) => {
      if (typeof id !== 'string' || id === '') {
        return Promise.resolve({ ok: false, error: 'A host needs an id to disconnect.' });
      }

      return envelope(() => disconnect(id));
    },
  };
}

/** A host being connected, or null when it is not one. */
function connectionIn(value: unknown): GitConnectionInput | null {
  if (typeof value !== 'object' || value === null) return null;

  const held = value as {
    provider?: unknown;
    instanceUrl?: unknown;
    accessToken?: unknown;
    webhookSecret?: unknown;
    accountLogin?: unknown;
  };
  if (typeof held.provider !== 'string' || !PROVIDERS.includes(held.provider)) return null;
  if (typeof held.accessToken !== 'string' || held.accessToken.trim() === '') return null;
  if (held.instanceUrl !== undefined && typeof held.instanceUrl !== 'string') return null;
  if (held.webhookSecret !== undefined && typeof held.webhookSecret !== 'string') return null;
  if (held.accountLogin !== undefined && typeof held.accountLogin !== 'string') return null;

  return {
    provider: held.provider,
    accessToken: held.accessToken.trim(),
    ...(held.instanceUrl === undefined ? {} : { instanceUrl: held.instanceUrl }),
    ...(held.webhookSecret === undefined ? {} : { webhookSecret: held.webhookSecret }),
    ...(held.accountLogin === undefined ? {} : { accountLogin: held.accountLogin }),
  };
}
