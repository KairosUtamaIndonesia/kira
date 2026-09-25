import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { DesktopUpdateSnapshot } from '../../preload/bridge.ts';
import { type UpdatesDeps, updatesHandlers } from './updates.ts';

const SNAPSHOT: DesktopUpdateSnapshot = {
  status: 'downloaded',
  currentVersion: '1.2.3',
  availableVersion: '1.3.0',
  error: null,
};

test('update handlers expose state and actions as Result values', async () => {
  const calls: string[] = [];
  const deps: UpdatesDeps = {
    snapshot: () => SNAPSHOT,
    check: async () => {
      calls.push('check');
      return { ...SNAPSHOT, status: 'up-to-date', availableVersion: null };
    },
    install: async () => {
      calls.push('install');
      return { installed: true, message: 'Restarting to install 1.3.0.' };
    },
  };
  const handlers = updatesHandlers(deps);

  assert.deepEqual(await handlers.load(), { ok: true, value: SNAPSHOT });
  assert.deepEqual(await handlers.check(), {
    ok: true,
    value: { ...SNAPSHOT, status: 'up-to-date', availableVersion: null },
  });
  assert.deepEqual(await handlers.install(), {
    ok: true,
    value: { installed: true, message: 'Restarting to install 1.3.0.' },
  });
  assert.deepEqual(calls, ['check', 'install']);
});

test('update handler errors are returned as values', async () => {
  const handlers = updatesHandlers({
    snapshot: () => SNAPSHOT,
    check: async () => {
      throw new Error('The update feed is unavailable.');
    },
    install: async () => ({ installed: false, message: 'Not ready.' }),
  });

  assert.deepEqual(await handlers.check(), {
    ok: false,
    error: 'The update feed is unavailable.',
  });
});
