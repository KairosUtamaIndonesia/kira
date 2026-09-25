import { describe, expect, test } from 'bun:test';
import { loadConfig } from './config';

const TENANT = '11111111-2222-3333-4444-555555555555';

const complete = {
  KIRA_ENTRA_TENANT_ID: TENANT,
  KIRA_ENTRA_CLIENT_ID: 'client-id',
  KIRA_ENTRA_CLIENT_SECRET: 'client-secret',
  KIRA_AUTH_SECRET: 'a'.repeat(32),
  KIRA_BASE_URL: 'https://kira.example.com',
};

describe('loadConfig', () => {
  test('reads a complete environment', () => {
    const config = loadConfig(complete);

    expect(config.entra.tenantId).toBe(TENANT);
    expect(config.entra.clientId).toBe('client-id');
    expect(config.entra.clientSecret).toBe('client-secret');
    expect(config.entra.authority).toBe('https://login.microsoftonline.com');
    expect(config.baseUrl).toBe('https://kira.example.com');
    expect(config.databaseUrl).toBe('postgres://kira:kira@127.0.0.1:5439/kira');
  });

  test('honours an explicit database', () => {
    const config = loadConfig({
      ...complete,
      KIRA_DATABASE_URL: 'postgres://kira:secret@db.internal:5432/kira',
    });

    expect(config.databaseUrl).toBe('postgres://kira:secret@db.internal:5432/kira');
  });

  test('takes the listening port from the base URL, so the two cannot disagree', () => {
    const config = loadConfig({ ...complete, KIRA_BASE_URL: 'http://localhost:4100' });

    expect(config.port).toBe(4100);
  });

  test('listens on the default port when the base URL has none', () => {
    const config = loadConfig(complete);

    expect(config.port).toBe(3000);
  });

  test('takes a value that is padded with whitespace', () => {
    const config = loadConfig({ ...complete, KIRA_ENTRA_TENANT_ID: `  ${TENANT}\n` });

    expect(config.entra.tenantId).toBe(TENANT);
  });

  test.each([
    {
      name: 'reports every missing variable at once',
      env: {},
      expected: [
        'KIRA_ENTRA_TENANT_ID',
        'KIRA_ENTRA_CLIENT_ID',
        'KIRA_ENTRA_CLIENT_SECRET',
        'KIRA_AUTH_SECRET',
        'KIRA_BASE_URL',
      ],
    },
    {
      name: 'rejects a tenant of common, which would accept every tenant',
      env: { ...complete, KIRA_ENTRA_TENANT_ID: 'common' },
      expected: ['KIRA_ENTRA_TENANT_ID'],
    },
    {
      name: 'rejects the organizations authority',
      env: { ...complete, KIRA_ENTRA_TENANT_ID: 'organizations' },
      expected: ['KIRA_ENTRA_TENANT_ID'],
    },
    {
      name: 'rejects the consumers authority',
      env: { ...complete, KIRA_ENTRA_TENANT_ID: 'consumers' },
      expected: ['KIRA_ENTRA_TENANT_ID'],
    },
    {
      name: 'rejects a wildcard tenant whatever its case',
      env: { ...complete, KIRA_ENTRA_TENANT_ID: 'Common' },
      expected: ['KIRA_ENTRA_TENANT_ID'],
    },
    {
      name: 'treats an empty value as unset, so a blank line is not a value',
      env: { ...complete, KIRA_ENTRA_TENANT_ID: '' },
      expected: ['KIRA_ENTRA_TENANT_ID'],
    },
    {
      name: 'rejects a value that is only whitespace',
      env: { ...complete, KIRA_ENTRA_CLIENT_ID: '   ' },
      expected: ['KIRA_ENTRA_CLIENT_ID'],
    },
    {
      name: 'rejects a secret shorter than Better Auth accepts',
      env: { ...complete, KIRA_AUTH_SECRET: 'too-short' },
      expected: ['KIRA_AUTH_SECRET'],
    },
    {
      name: 'rejects a base URL that is not a URL',
      env: { ...complete, KIRA_BASE_URL: 'kira.example.com' },
      expected: ['KIRA_BASE_URL'],
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
