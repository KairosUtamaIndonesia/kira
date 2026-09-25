import { afterAll, describe, expect, test } from 'bun:test';
import type { UserWithRole } from 'better-auth/plugins/admin';
import { grantAdmin } from './admin';
import type { Auth } from './auth';
import { boot, closeDatabases, user } from './test-support/server';

// The connections this file opened are let go when it ends; see `closeDatabases`.
afterAll(closeDatabases);

/**
 * Who the user row says this person is, as the plugin reads it back.
 *
 * The plugin widens the user model with a role rather than the adapter typing it,
 * so the column is read through the plugin's own type instead of one invented
 * here.
 */
async function roleOf(auth: Auth, email: string): Promise<string | undefined> {
  const context = await auth.$context;
  const found = await context.internalAdapter.findUserByEmail(email);

  return (found?.user as UserWithRole | undefined)?.role;
}

describe('granting an admin', () => {
  test('the person who signed in is an admin afterwards', async () => {
    const { auth } = await boot();
    await user(auth, 'ada@company.example');

    expect(await grantAdmin(auth, 'ada@company.example')).toEqual({ granted: true });
    expect(await roleOf(auth, 'ada@company.example')).toBe('admin');
  });

  test('an address that arrives in any case names the same person', async () => {
    const { auth } = await boot();
    await user(auth, 'ada@company.example');

    expect(await grantAdmin(auth, 'Ada@Company.Example')).toEqual({ granted: true });
    expect(await roleOf(auth, 'ada@company.example')).toBe('admin');
  });

  test('granting twice is the same as granting once', async () => {
    const { auth } = await boot();
    await user(auth, 'ada@company.example');

    await grantAdmin(auth, 'ada@company.example');

    expect(await grantAdmin(auth, 'ada@company.example')).toEqual({ granted: true });
    expect(await roleOf(auth, 'ada@company.example')).toBe('admin');
  });

  test('nobody has that address until they have signed in', async () => {
    const { auth } = await boot();

    const result = await grantAdmin(auth, 'ada@company.example');

    expect(result.granted).toBe(false);
    expect(result).toHaveProperty('reason', 'ada@company.example has not signed in yet');
  });

  test('signing in gives the plain role, never the one this grants', async () => {
    const { auth } = await boot();
    await user(auth, 'ada@company.example');

    // Signing in is Entra's word for who someone is; the role is Kira's word
    // for what they run. A new user arrives with the ordinary one.
    expect(await roleOf(auth, 'ada@company.example')).toBe('user');
  });
});
