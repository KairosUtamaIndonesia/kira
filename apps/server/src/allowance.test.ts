import { afterAll, describe, expect, test } from 'bun:test';
import { grantAdmin } from './admin';
import { allowanceFor, type AllowanceSettings, setAllowance, standingFor } from './allowance';
import {
  bearer,
  boot,
  closeDatabases,
  consoleSession,
  issue,
  listening,
  send,
  spent,
  user,
} from './test-support/server';

/** The person the stand-in Microsoft signs in as. */
const ADA = {
  oid: 'aaaaaaaa-0000-0000-0000-000000000001',
  tid: '11111111-2222-3333-4444-555555555555',
  name: 'Ada Lovelace',
  email: 'ada@company.example',
};

afterAll(closeDatabases);

/** Small numbers, so a threshold is reachable without writing millions of tokens. */
const SETTINGS: AllowanceSettings = { defaultTokens: 1000, timezone: 'Asia/Jakarta' };

/** One second either side of Jakarta midnight, which is where September begins in WIB. */
const LATE_AUGUST = '2026-08-31T16:59:59.000Z';
const EARLY_SEPTEMBER = '2026-08-31T17:00:00.000Z';

describe('an allowance', () => {
  test('is the default until somebody is given one of their own', async () => {
    const { auth, database } = await boot();
    const ada = await user(auth);
    const now = new Date('2026-09-10T00:00:00.000Z');

    expect(await allowanceFor(database, ada.id, SETTINGS)).toBe(1000);
    expect((await standingFor(database, ada.id, SETTINGS, now)).allowance).toBe(1000);

    await setAllowance(database, ada.id, 5000);

    expect(await allowanceFor(database, ada.id, SETTINGS)).toBe(5000);
    expect((await standingFor(database, ada.id, SETTINGS, now)).allowance).toBe(5000);

    // Clearing the row is how somebody goes back to the default: there is no
    // number that means "ask the default".
    await setAllowance(database, ada.id, null);

    expect((await standingFor(database, ada.id, SETTINGS, now)).allowance).toBe(1000);
  });

  test('is spent by input and output, and not by cache reads', async () => {
    const { auth, database } = await boot();
    const ada = await user(auth);

    await spent(database, ada.id, {
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 900,
      cacheWriteTokens: 40,
      at: '2026-09-05T00:00:00.000Z',
    });

    const standing = await standingFor(
      database,
      ada.id,
      SETTINGS,
      new Date('2026-09-10T00:00:00.000Z'),
    );

    expect(standing).toMatchObject({
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 900,
      cacheWriteTokens: 40,
      used: 150,
    });

    // 150 of 1000 is nowhere near the warning, though the cache reads alone
    // would have been past it.
    expect(standing.warned).toBe(false);
  });

  test('turns over at Jakarta midnight, not at UTC midnight', async () => {
    const { auth, database } = await boot();
    const ada = await user(auth);

    await spent(database, ada.id, { inputTokens: 10, at: LATE_AUGUST });
    await spent(database, ada.id, { inputTokens: 25, at: EARLY_SEPTEMBER });

    // Standing in September: the August request is behind the window, and the
    // window is a Jakarta month rather than a UTC one.
    const september = await standingFor(
      database,
      ada.id,
      SETTINGS,
      new Date('2026-09-10T00:00:00.000Z'),
    );

    expect(september.used).toBe(25);
    expect(september.window).toEqual({
      start: '2026-08-31T17:00:00.000Z',
      end: '2026-09-30T17:00:00.000Z',
    });

    // Standing one second before that boundary: the same two requests, on the
    // other sides of it.
    const august = await standingFor(database, ada.id, SETTINGS, new Date(LATE_AUGUST));

    expect(august.used).toBe(10);
    expect(august.window).toEqual({
      start: '2026-07-31T17:00:00.000Z',
      end: '2026-08-31T17:00:00.000Z',
    });
  });

  test('warns somebody who is close to theirs', async () => {
    const { auth, database } = await boot();
    const ada = await user(auth);
    const now = new Date('2026-09-10T00:00:00.000Z');

    await spent(database, ada.id, { inputTokens: 799, at: '2026-09-05T00:00:00.000Z' });
    expect((await standingFor(database, ada.id, SETTINGS, now)).warned).toBe(false);

    await spent(database, ada.id, { inputTokens: 1, at: '2026-09-06T00:00:00.000Z' });
    expect((await standingFor(database, ada.id, SETTINGS, now)).warned).toBe(true);
  });
});

describe('reading and changing an allowance', () => {
  test('a user reads their own month with their own key, and nobody else’s', async () => {
    const { app, auth, config, database } = await boot();
    const ada = await user(auth);
    const grace = await user(auth, 'grace@company.example');
    const key = await issue(auth, ada.id, 'workstation');
    const at = new Date().toISOString();

    await spent(database, ada.id, { inputTokens: 40, outputTokens: 10, at });
    await spent(database, grace.id, { inputTokens: 900, at });

    const response = await send(app, '/api/usage', { headers: bearer(key.key) });

    // The route takes no person to name, so the key is the whole of the question
    // — which is what makes "nobody else's" structural rather than a check.
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      used: 50,
      allowance: config.allowance.defaultTokens,
      override: null,
      refusals: [],
    });
  });

  test('a key is not an operator, and neither is an ordinary session', async () => {
    const server = await listening(ADA);
    try {
      const grace = await user(server.auth, 'grace@company.example');
      const key = await issue(server.auth, grace.id, 'workstation');

      // A key, however good, is not the console: the operator's routes are the
      // console's, and the console is what signs in.
      const withKey = await fetch(`${server.origin}/api/admin/usage/${grace.id}`, {
        headers: bearer(key.key),
      });

      expect(withKey.status).toBe(401);
      expect((await withKey.json()).error.code).toBe('NOT_SIGNED_IN');

      // Signed in, and still not an administrator.
      const cookie = await consoleSession(server.origin);
      const asPerson = await fetch(`${server.origin}/api/admin/usage/${grace.id}`, {
        headers: { cookie },
      });

      expect(asPerson.status).toBe(403);
      expect((await asPerson.json()).error.code).toBe('NOT_AN_ADMIN');
    } finally {
      await server.stop();
    }
  });

  test('an operator reads anybody, sets an allowance, and takes it away', async () => {
    const server = await listening(ADA);
    try {
      const grace = await user(server.auth, 'grace@company.example');
      await spent(server.database, grace.id, {
        inputTokens: 120,
        at: new Date().toISOString(),
      });

      const cookie = await consoleSession(server.origin);

      // The first administrator is granted out of band, by the CLI's own write
      // (docs/adr/0007-admins.md).
      expect((await grantAdmin(server.auth, ADA.email)).granted).toBe(true);

      const read = await fetch(`${server.origin}/api/admin/usage/${grace.id}`, {
        headers: { cookie },
      });
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ used: 120, override: null, refusals: [] });

      const set = await fetch(`${server.origin}/api/admin/allowance/${grace.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ tokensPerMonth: 5000 }),
      });
      expect(set.status).toBe(200);
      expect(await set.json()).toMatchObject({ allowance: 5000, override: 5000, used: 120 });

      // Null is how an override is taken away, and the default applies again.
      const cleared = await fetch(`${server.origin}/api/admin/allowance/${grace.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ tokensPerMonth: null }),
      });
      expect(cleared.status).toBe(200);
      expect(await cleared.json()).toMatchObject({
        allowance: server.config.allowance.defaultTokens,
        override: null,
      });
    } finally {
      await server.stop();
    }
  });

  test('an allowance cannot be set on somebody who does not exist', async () => {
    const server = await listening(ADA);
    try {
      const cookie = await consoleSession(server.origin);
      await grantAdmin(server.auth, ADA.email);

      const response = await fetch(`${server.origin}/api/admin/allowance/nobody-at-all`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ tokensPerMonth: 100 }),
      });

      // A reference would refuse this anyway; a 404 is the answer that says what
      // actually happened.
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe('USER_NOT_FOUND');
    } finally {
      await server.stop();
    }
  });
});
