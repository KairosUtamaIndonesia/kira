import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { GitConnection, GitConnectionInput } from '../../preload/bridge.ts';
import { gitHandlers } from './git.ts';

const connection: GitConnection = {
  id: 'conn-1',
  provider: 'forgejo',
  authKind: 'token',
  instanceUrl: 'https://git.example.com',
  accountLogin: 'acme',
  accountType: 'User',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const created = { connection, webhookSecret: 'a-secret' };

/** Deps that record what they were asked, with the host methods each test needs. */
function deps(
  calls: string[],
  overrides: Partial<Parameters<typeof gitHandlers>[0]> = {},
): Parameters<typeof gitHandlers>[0] {
  return {
    connections: async () => {
      calls.push('connections');
      return [connection];
    },
    connect: async () => created,
    disconnect: async () => null,
    githubConnect: async () => {
      calls.push('githubConnect');
      return { configured: false, url: null };
    },
    connectionRepositories: async () => [],
    ...overrides,
  };
}

test('connections lists the hosts the server is connected to', async () => {
  const calls: string[] = [];
  const handlers = gitHandlers(deps(calls));

  assert.deepEqual(await handlers.connections(), { ok: true, value: [connection] });
  assert.deepEqual(calls, ['connections']);
});

test('githubConnect reports where to install the App', async () => {
  const calls: string[] = [];
  const handlers = gitHandlers(
    deps(calls, {
      githubConnect: async () => ({ configured: true, url: 'https://github.com/apps/kira' }),
    }),
  );

  assert.deepEqual(await handlers.githubConnect(), {
    ok: true,
    value: { configured: true, url: 'https://github.com/apps/kira' },
  });
});

test('connect checks the host and the token before forwarding', async () => {
  const calls: string[] = [];
  const handlers = gitHandlers(
    deps(calls, {
      connect: async (input: GitConnectionInput) => {
        calls.push(`connect ${input.provider} ${input.instanceUrl ?? ''}`);
        return created;
      },
    }),
  );

  assert.deepEqual(
    await handlers.connect({
      provider: 'forgejo',
      instanceUrl: 'https://git.example.com',
      accessToken: 'a-token',
    }),
    { ok: true, value: created },
  );
  assert.deepEqual(calls, ['connect forgejo https://git.example.com']);

  assert.deepEqual(await handlers.connect({ provider: 'bitbucket', accessToken: 'a-token' }), {
    ok: false,
    error: 'That is not a host to connect.',
  });
  assert.deepEqual(await handlers.connect({ provider: 'github', accessToken: '  ' }), {
    ok: false,
    error: 'That is not a host to connect.',
  });
});

test('disconnect checks the id, and the server refusal is preserved', async () => {
  const calls: string[] = [];
  const handlers = gitHandlers(
    deps(calls, {
      disconnect: async (id: string) => {
        calls.push(`disconnect ${id}`);
        throw new Error('Only an administrator can connect a Git host.');
      },
    }),
  );

  assert.deepEqual(await handlers.disconnect('conn-1'), {
    ok: false,
    error: 'Only an administrator can connect a Git host.',
  });
  assert.deepEqual(await handlers.disconnect(''), {
    ok: false,
    error: 'A host needs an id to disconnect.',
  });
  assert.deepEqual(calls, ['disconnect conn-1']);
});

test('connectionRepositories checks the id, then forwards it', async () => {
  const calls: string[] = [];
  const handlers = gitHandlers(
    deps(calls, {
      connectionRepositories: async (id: string) => {
        calls.push(`connectionRepositories ${id}`);
        return [{ owner: 'acme', name: 'api', defaultBranch: 'main' }];
      },
    }),
  );

  assert.deepEqual(await handlers.connectionRepositories('conn-1'), {
    ok: true,
    value: [{ owner: 'acme', name: 'api', defaultBranch: 'main' }],
  });
  assert.deepEqual(await handlers.connectionRepositories(''), {
    ok: false,
    error: 'A host needs an id to list its repositories.',
  });
  assert.deepEqual(calls, ['connectionRepositories conn-1']);
});
