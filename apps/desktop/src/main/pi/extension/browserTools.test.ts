import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BrowserOperation } from '../../browser/controller.ts';
import { browserTools } from './browserTools.ts';

test('browser tools stay bound to their chat and expose bounded page actions', async () => {
  const calls: Array<{ chatId: string; operation: BrowserOperation }> = [];
  const tools = browserTools('chat-one', async (chatId, operation) => {
    calls.push({ chatId, operation });
    return operation.action === 'screenshot'
      ? { type: 'image', data: 'cG5n', mimeType: 'image/png' }
      : 'done';
  });

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['browser_open', 'browser_snapshot', 'browser_click', 'browser_fill', 'browser_screenshot'],
  );

  const opened = await tools[0]!.execute(
    'call-open',
    { url: 'https://example.com' },
    undefined,
    undefined,
    {} as never,
  );
  assert.deepEqual(opened.content, [{ type: 'text', text: 'done' }]);

  const filled = await tools[3]!.execute(
    'call-fill',
    { selector: 'input[name="q"]', text: 'Kira' },
    undefined,
    undefined,
    {} as never,
  );
  assert.deepEqual(filled.content, [{ type: 'text', text: 'done' }]);

  const screenshot = await tools[4]!.execute('call-image', {}, undefined, undefined, {} as never);
  assert.deepEqual(screenshot.content, [{ type: 'image', data: 'cG5n', mimeType: 'image/png' }]);
  assert.deepEqual(calls, [
    { chatId: 'chat-one', operation: { action: 'navigate', url: 'https://example.com' } },
    {
      chatId: 'chat-one',
      operation: { action: 'fill', selector: 'input[name="q"]', text: 'Kira' },
    },
    { chatId: 'chat-one', operation: { action: 'screenshot' } },
  ]);
});
