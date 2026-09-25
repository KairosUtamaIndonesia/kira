import { afterAll, afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { type Auth, createAuth } from './auth';
import { loadConfig } from './config';
import { migrate } from './database';
import {
  bearer,
  boot,
  closeDatabases,
  ENV,
  freshDatabase,
  issue,
  send,
  TENANT,
  user,
} from './test-support/server';

// The connections this file opened are let go when it ends; see `closeDatabases`.
afterAll(closeDatabases);

/**
 * Take a key out of circulation. Better Auth's revocation endpoint is
 * session-authenticated and a session needs Entra, but deleting through the
 * adapter removes the row the plugin reads back, so the refusal a test sees is
 * the real one.
 */
async function revoke(auth: Auth, keyId: string) {
  const context = await auth.$context;
  await context.adapter.delete({ model: 'apikey', where: [{ field: 'id', value: keyId }] });
}

afterEach(() => {
  setSystemTime();
});

describe('GET /api/me', () => {
  const refusals: { name: string; headers: Record<string, string>; expected: string }[] = [
    { name: 'no Authorization header', headers: {}, expected: 'KEY_NOT_FOUND' },
    {
      name: 'an empty bearer token',
      headers: { authorization: 'Bearer ' },
      expected: 'KEY_NOT_FOUND',
    },
    {
      name: 'a scheme that is not Bearer',
      headers: { authorization: 'Basic abc' },
      expected: 'KEY_NOT_FOUND',
    },
    {
      name: 'a bare key with no scheme',
      headers: { authorization: 'abc' },
      expected: 'KEY_NOT_FOUND',
    },
    {
      name: 'a well-formed key that was never issued',
      headers: { authorization: 'Bearer 0123456789abcdef' },
      expected: 'INVALID_API_KEY',
    },
  ];

  test.each(refusals)('refuses $name', async ({ headers, expected }) => {
    const { app } = await boot();

    const response = await send(app, '/api/me', { headers });

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe(expected);
  });

  test('answers with the user the key belongs to', async () => {
    const { app, auth } = await boot();
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'laptop');

    const response = await send(app, '/api/me', { headers: bearer(key.key) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: ada.id,
      email: 'ada@company.example',
      name: 'Ada Lovelace',
    });
  });

  test('refuses a key past its expiry', async () => {
    const { app, auth } = await boot();
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'laptop');

    setSystemTime(new Date(Date.now() + 100 * 24 * 60 * 60 * 1000));
    const response = await send(app, '/api/me', { headers: bearer(key.key) });

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('KEY_EXPIRED');
  });

  test('refuses a key that has been revoked', async () => {
    const { app, auth } = await boot();
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'laptop');
    await revoke(auth, key.id);

    const response = await send(app, '/api/me', { headers: bearer(key.key) });

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('INVALID_API_KEY');
  });

  test('revoking one device leaves the user signed in on their other device', async () => {
    const { app, auth } = await boot();
    const ada = await user(auth);
    const laptop = await issue(auth, ada.id, 'laptop');
    const desktop = await issue(auth, ada.id, 'desktop');
    await revoke(auth, laptop.id);

    const cut = await send(app, '/api/me', { headers: bearer(laptop.key) });
    const kept = await send(app, '/api/me', { headers: bearer(desktop.key) });

    expect(cut.status).toBe(401);
    expect(kept.status).toBe(200);
  });

  test('answers a key more than ten times in a day', async () => {
    const { app, auth } = await boot();
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'laptop');

    const statuses: number[] = [];
    for (let request = 0; request < 12; request += 1) {
      statuses.push((await send(app, '/api/me', { headers: bearer(key.key) })).status);
    }

    expect(statuses).toEqual(Array.from({ length: 12 }, () => 200));
  });

  test('issues a key with a bounded lifetime', async () => {
    const { auth } = await boot();
    const ada = await user(auth);

    const key = await issue(auth, ada.id, 'laptop');
    const days = (new Date(key.expiresAt as Date).getTime() - Date.now()) / 86_400_000;

    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThanOrEqual(90);
  });

  test('a key is not a session and cannot mint another key', async () => {
    const { app, auth } = await boot();
    const ada = await user(auth);
    const key = await issue(auth, ada.id, 'laptop');

    const response = await send(app, '/api/auth/api-key/create', {
      method: 'POST',
      headers: { ...bearer(key.key), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'second' }),
    });

    expect(response.status).toBe(401);
  });
});

describe('sign-in', () => {
  test('serves a page that can start the flow', async () => {
    const { app } = await boot();

    const response = await send(app, '/sign-in');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('form');
  });

  test('starts a Microsoft flow scoped to the company tenant', async () => {
    const { app } = await boot();

    const response = await send(app, '/sign-in', { method: 'POST' });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
    );
    expect(location.searchParams.get('client_id')).toBe('client-id');
  });

  test('hands the browser the state cookie the callback will check', async () => {
    const { app } = await boot();

    const response = await send(app, '/sign-in', { method: 'POST' });

    expect(
      response.headers.getSetCookie().some((cookie) => cookie.startsWith('better-auth.state=')),
    ).toBe(true);
  });
});

describe('boot', () => {
  test('a second boot against the same database keeps what is already there', async () => {
    const config = loadConfig(ENV);
    const database = await freshDatabase(config.databaseUrl);
    // Migrating and building twice is what a hot reload does, and it is why
    // neither may throw the first run away.
    await migrate(database);
    const first = await createAuth(config, database);
    const ada = await user(first);
    const key = await issue(first, ada.id, 'laptop');

    await migrate(database);
    const second = await createAuth(config, database);

    const verification = await second.api.verifyApiKey({ body: { key: key.key } });
    expect(verification.valid).toBe(true);
  });

  test('still answers the liveness check', async () => {
    const { app } = await boot();

    const response = await send(app, '/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});

describe('the documented API', () => {
  test('leaves the pool routes out of it', async () => {
    const { app } = await boot();

    const paths = Object.keys((await (await send(app, '/openapi/json')).json()).paths);

    // The document is really there, so the two claims below mean something.
    expect(paths).toContain('/health');

    // ADR 0003: the OpenAI-shaped seam is a compatibility surface for the
    // desktop's client rather than an API Foundry offers, and the catalog is
    // shaped for that same client. Documenting either would promise a shape
    // Foundry does not own.
    expect(paths).not.toContain('/v1/chat/completions');
    expect(paths).not.toContain('/api/models');
  });
});
