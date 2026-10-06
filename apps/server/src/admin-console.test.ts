import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdminConsole } from './admin-console';

const made: string[] = [];

afterAll(async () => {
  for (const directory of made) await rm(directory, { recursive: true, force: true });
});

/** A console as a build leaves one: an entry page and one hashed asset. */
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'kira-admin-'));
  made.push(directory);
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'index.html'), '<!doctype html><div id="root"></div>');
  await writeFile(join(directory, 'assets', 'index-abc123.js'), 'console.log(1);');

  return createAdminConsole(directory);
}

function get(app: ReturnType<typeof createAdminConsole>, path: string) {
  return app.handle(new Request(`http://localhost${path}`));
}

describe('serving the built console', () => {
  test('serves the entry page at /admin/, under a policy and uncached', async () => {
    const response = await get(await fixture(), '/admin/');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="root"');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  test('serves the entry page at /admin as well', async () => {
    const response = await get(await fixture(), '/admin');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="root"');
  });

  test('serves a hashed asset immutably', async () => {
    const response = await get(await fixture(), '/admin/assets/index-abc123.js');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('content-type')).toContain('javascript');
  });

  test('falls back to the entry page for a deep link', async () => {
    const response = await get(await fixture(), '/admin/users/grace');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="root"');
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  test('never serves a path that climbs out of the console', async () => {
    const response = await get(await fixture(), '/admin/%2e%2e/%2e%2e/etc/passwd');

    // The traversal is refused as a file; the secret is nowhere in the answer.
    expect(await response.text()).not.toContain('root:x:');
  });
});
