import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  browsersFromPersistence,
  browsersForPersistence,
  closedBrowser,
  normalizedBrowserUrl,
  openedBrowser,
  pageLoadFailureMessage,
  showingBrowser,
} from './state.ts';

describe('browser tabs', () => {
  test('keeps tabs and active selection separate for each chat', () => {
    const first = openedBrowser({}, 'chat-a', {
      id: 'one',
      url: 'https://one.test/',
      title: 'One',
    });
    const second = openedBrowser(first, 'chat-b', {
      id: 'two',
      url: 'https://two.test/',
      title: 'Two',
    });

    assert.equal(second['chat-a']?.activeId, 'one');
    assert.equal(second['chat-b']?.activeId, 'two');
  });

  test('closes the active tab onto its next neighbour, or previous at the end', () => {
    const all = openedBrowser(
      openedBrowser(
        openedBrowser({}, 'chat', { id: 'a', url: 'https://a.test', title: 'A' }),
        'chat',
        { id: 'b', url: 'https://b.test', title: 'B' },
      ),
      'chat',
      { id: 'c', url: 'https://c.test', title: 'C' },
    );

    assert.equal(closedBrowser(all, 'chat', 'b')['chat']?.activeId, 'c');
    assert.equal(closedBrowser(all, 'chat', 'c')['chat']?.activeId, 'b');
  });

  test('does not select a browser tab that is not open in that chat', () => {
    assert.deepEqual(showingBrowser({}, 'chat', 'missing'), {});
  });

  const urlCases = [
    ['bare host', 'example.com', 'https://example.com/'],
    ['http local address', 'http://localhost:3000/', 'http://localhost:3000/'],
    ['script URL', 'javascript:alert(1)', null],
    ['file URL', 'file:///etc/passwd', null],
    ['embedded credentials', 'https://user:pass@example.com', null],
    ['malformed URL', 'http://[', null],
  ] as const;

  for (const [name, input, expected] of urlCases) {
    test(`normalizes ${name}`, () => {
      assert.equal(normalizedBrowserUrl(input), expected);
    });
  }

  test('drops unsafe and malformed persisted tabs', () => {
    const restored = browsersFromPersistence({
      chat: {
        activeId: 'unsafe',
        tabs: [
          { id: 'safe', title: 'Safe', url: 'example.com' },
          { id: 'unsafe', title: 'Unsafe', url: 'javascript:alert(1)' },
        ],
      },
    });

    assert.deepEqual(browsersForPersistence(restored), {
      chat: {
        activeId: 'safe',
        tabs: [{ id: 'safe', title: 'Safe', url: 'https://example.com/' }],
      },
    });
  });

  test('reports only failed main-frame navigations', async (t) => {
    const cases: [string, number, boolean, string | undefined, string | null][] = [
      ['main-frame failure', -27, true, 'ERR_BLOCKED_BY_RESPONSE', 'ERR_BLOCKED_BY_RESPONSE'],
      ['subframe failure', -27, false, 'ERR_BLOCKED_BY_RESPONSE', null],
      ['aborted main-frame navigation', -3, true, 'ERR_ABORTED', null],
      ['missing failure description', -2, true, undefined, 'The page could not be loaded.'],
    ];

    for (const [name, errorCode, isMainFrame, errorDescription, expected] of cases) {
      await t.test(name, () => {
        assert.equal(
          pageLoadFailureMessage({ errorCode, isMainFrame, errorDescription }),
          expected,
        );
      });
    }
  });
});
