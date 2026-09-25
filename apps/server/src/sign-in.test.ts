import { afterAll, describe, expect, test } from 'bun:test';
import { grantAdmin } from './admin';
import type { Auth } from './auth';
import { startFakeEntra } from './test-support/fake-entra';
import {
  bearer,
  boot,
  cookieHeader,
  closeDatabases,
  ORIGIN,
  send,
  TENANT,
} from './test-support/server';

// The connections this file opened are let go when it ends; see `closeDatabases`.
afterAll(closeDatabases);

const ADA = {
  oid: 'aaaaaaaa-0000-0000-0000-000000000001',
  tid: TENANT,
  name: 'Ada Lovelace',
  email: 'ada@company.example',
};

type App = Awaited<ReturnType<typeof boot>>['app'];

/**
 * Walk the journey a browser walks — Kira, Microsoft, and back — and report
 * where it ends up.
 */
async function signIn(app: App) {
  const started = await send(app, '/sign-in', { method: 'POST' });
  const toMicrosoft = started.headers.get('location');
  if (!toMicrosoft) throw new Error('sign-in did not send the browser to Microsoft');

  // The browser visiting Microsoft, which sends it straight back to Kira.
  // Redirects are not followed: where Microsoft points the browser is exactly
  // what the next step needs to know, and `baseUrl` is not this process.
  const returned = await fetch(toMicrosoft, { redirect: 'manual' });
  const back = returned.headers.get('location');
  await returned.body?.cancel();
  if (!back) throw new Error('Microsoft did not send the browser back');

  const callback = new URL(back);
  const finished = await send(app, `${callback.pathname}${callback.search}`, {
    headers: { cookie: cookieHeader(started) },
  });

  return { started, toMicrosoft, finished };
}

/** The user the session cookie names. */
async function sessionUser(auth: Auth, response: Response) {
  const session = await auth.api.getSession({
    headers: new Headers({ cookie: cookieHeader(response) }),
  });
  if (!session) throw new Error('sign-in left no session');
  return session.user;
}

const cases: { name: string; signIns: number }[] = [
  { name: 'a company account signs in', signIns: 1 },
  { name: 'signing in again is the same user', signIns: 2 },
];

describe('sign-in', () => {
  test.each(cases)('$name', async ({ signIns }) => {
    const entra = await startFakeEntra(ADA);
    try {
      const { app, auth } = await boot({ authority: entra.authority });

      const signedIn = [];
      for (let attempt = 0; attempt < signIns; attempt += 1) {
        const { finished } = await signIn(app);
        expect(finished.headers.get('location')).toBe(ORIGIN);
        signedIn.push(await sessionUser(auth, finished));
      }

      expect(signedIn.at(-1)?.email).toBe(ADA.email);
      // Account identity is the oid, so the same person is one user however
      // many times they sign in.
      expect(new Set(signedIn.map((user) => user.id)).size).toBe(1);
    } finally {
      await entra.stop();
    }
  });

  test('asks Microsoft for the company tenant and no other', async () => {
    const entra = await startFakeEntra(ADA);
    try {
      const { app } = await boot({ authority: entra.authority });

      await signIn(app);

      expect(entra.authorizations).toEqual([TENANT]);
      expect(entra.tokenExchanges).toEqual([TENANT]);
    } finally {
      await entra.stop();
    }
  });

  test('the key a signed-in device is given identifies its user', async () => {
    const entra = await startFakeEntra(ADA);
    try {
      const { app, auth } = await boot({ authority: entra.authority });
      const { finished } = await signIn(app);

      const created = await send(app, '/api/auth/api-key/create', {
        method: 'POST',
        headers: {
          cookie: cookieHeader(finished),
          'content-type': 'application/json',
          // Better Auth refuses a session-authenticated write with no Origin,
          // which a browser always sends and a scripted client must add.
          origin: ORIGIN,
        },
        body: JSON.stringify({ name: 'laptop' }),
      });
      expect(created.status).toBe(200);

      const { key } = await created.json();
      const me = await send(app, '/api/me', { headers: bearer(key) });

      expect(me.status).toBe(200);
      expect(await me.json()).toEqual({
        id: (await sessionUser(auth, finished)).id,
        email: ADA.email,
        name: ADA.name,
      });
    } finally {
      await entra.stop();
    }
  });

  test('signing in is not the same as administering Kira', async () => {
    const entra = await startFakeEntra(ADA);
    try {
      const { app, auth } = await boot({ authority: entra.authority });
      const { finished } = await signIn(app);
      const asAda = { cookie: cookieHeader(finished) };

      // Every employee can sign in and none of them runs Kira, so the session
      // says who someone is and the role is the second question asked on top of
      // it (ADR 0007). The admin plugin's own surface is where that is answered,
      // which is what makes it the thing the console calls.
      const refused = await send(app, '/api/auth/admin/list-users', { headers: asAda });
      expect(refused.status).toBe(403);

      await grantAdmin(auth, ADA.email);

      // Read from the user row on each request rather than carried in the session,
      // so the grant is already in force for the session that is open.
      const listed = await send(app, '/api/auth/admin/list-users', { headers: asAda });
      expect(listed.status).toBe(200);

      const { users } = (await listed.json()) as { users: { email: string }[] };
      expect(users.map((user) => user.email)).toContain(ADA.email);
    } finally {
      await entra.stop();
    }
  });
});
