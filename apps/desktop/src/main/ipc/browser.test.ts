import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { browserHandlers } from './browser.ts';

describe('browser channels', () => {
  test('passes guest registration through the sender-bound controller', async () => {
    const calls: unknown[][] = [];
    const handlers = browserHandlers({
      register: (...args) => calls.push(args),
      activate: (...args) => calls.push(args),
      deactivate: (...args) => calls.push(args),
    });
    const sender = { id: 8 };
    const registration = { browserId: 'browser-1', chatId: 'chat-1', webContentsId: 41 };

    assert.deepEqual(await handlers.register(sender, registration), { ok: true, value: null });
    assert.deepEqual(calls, [[sender, registration]]);
  });

  test('returns controller refusals as a result value', async () => {
    const handlers = browserHandlers({
      register: () => {
        throw new Error('guest belongs to another window');
      },
      activate: () => {},
      deactivate: () => {},
    });

    assert.deepEqual(
      await handlers.register(
        { id: 8 },
        { browserId: 'browser-1', chatId: 'chat-1', webContentsId: 41 },
      ),
      { ok: false, error: 'guest belongs to another window' },
    );
  });
});
