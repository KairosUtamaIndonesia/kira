import { describe, expect, test } from 'bun:test';
import { loadConfig } from './config';

const TENANT = '11111111-2222-3333-4444-555555555555';

const complete = {
  FOUNDRY_ENTRA_TENANT_ID: TENANT,
  FOUNDRY_ENTRA_CLIENT_ID: 'client-id',
  FOUNDRY_ENTRA_CLIENT_SECRET: 'client-secret',
  FOUNDRY_AUTH_SECRET: 'a'.repeat(32),
  FOUNDRY_BASE_URL: 'https://foundry.example.com',
};

describe('loadConfig', () => {
  test('reads a complete environment', () => {
    const config = loadConfig(complete);

    expect(config.entra.tenantId).toBe(TENANT);
    expect(config.entra.clientId).toBe('client-id');
    expect(config.entra.clientSecret).toBe('client-secret');
    expect(config.entra.authority).toBe('https://login.microsoftonline.com');
    expect(config.baseUrl).toBe('https://foundry.example.com');
    expect(config.databaseUrl).toBe('postgres://foundry:foundry@127.0.0.1:5439/foundry');
  });

  test('honours an explicit database', () => {
    const config = loadConfig({
      ...complete,
      FOUNDRY_DATABASE_URL: 'postgres://foundry:secret@db.internal:5432/foundry',
    });

    expect(config.databaseUrl).toBe('postgres://foundry:secret@db.internal:5432/foundry');
  });

  test('takes the listening port from the base URL, so the two cannot disagree', () => {
    const config = loadConfig({ ...complete, FOUNDRY_BASE_URL: 'http://localhost:4100' });

    expect(config.port).toBe(4100);
  });

  test('listens on the default port when the base URL has none', () => {
    const config = loadConfig(complete);

    expect(config.port).toBe(3000);
  });

  test('takes a value that is padded with whitespace', () => {
    const config = loadConfig({ ...complete, FOUNDRY_ENTRA_TENANT_ID: `  ${TENANT}\n` });

    expect(config.entra.tenantId).toBe(TENANT);
  });

  test.each([
    {
      name: 'reports every missing variable at once',
      env: {},
      expected: [
        'FOUNDRY_ENTRA_TENANT_ID',
        'FOUNDRY_ENTRA_CLIENT_ID',
        'FOUNDRY_ENTRA_CLIENT_SECRET',
        'FOUNDRY_AUTH_SECRET',
        'FOUNDRY_BASE_URL',
      ],
    },
    {
      name: 'rejects a tenant of common, which would accept every tenant',
      env: { ...complete, FOUNDRY_ENTRA_TENANT_ID: 'common' },
      expected: ['FOUNDRY_ENTRA_TENANT_ID'],
    },
    {
      name: 'rejects the organizations authority',
      env: { ...complete, FOUNDRY_ENTRA_TENANT_ID: 'organizations' },
      expected: ['FOUNDRY_ENTRA_TENANT_ID'],
    },
    {
      name: 'rejects the consumers authority',
      env: { ...complete, FOUNDRY_ENTRA_TENANT_ID: 'consumers' },
      expected: ['FOUNDRY_ENTRA_TENANT_ID'],
    },
    {
      name: 'rejects a wildcard tenant whatever its case',
      env: { ...complete, FOUNDRY_ENTRA_TENANT_ID: 'Common' },
      expected: ['FOUNDRY_ENTRA_TENANT_ID'],
    },
    {
      name: 'treats an empty value as unset, so a blank line is not a value',
      env: { ...complete, FOUNDRY_ENTRA_TENANT_ID: '' },
      expected: ['FOUNDRY_ENTRA_TENANT_ID'],
    },
    {
      name: 'rejects a value that is only whitespace',
      env: { ...complete, FOUNDRY_ENTRA_CLIENT_ID: '   ' },
      expected: ['FOUNDRY_ENTRA_CLIENT_ID'],
    },
    {
      name: 'rejects a secret shorter than Better Auth accepts',
      env: { ...complete, FOUNDRY_AUTH_SECRET: 'too-short' },
      expected: ['FOUNDRY_AUTH_SECRET'],
    },
    {
      name: 'rejects a base URL that is not a URL',
      env: { ...complete, FOUNDRY_BASE_URL: 'foundry.example.com' },
      expected: ['FOUNDRY_BASE_URL'],
    },
  ])('$name', ({ env, expected }) => {
    let thrown: Error | undefined;
    try {
      loadConfig(env);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    for (const variable of expected) {
      expect(thrown?.message).toContain(variable);
    }
  });
});
