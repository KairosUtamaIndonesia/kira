import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { browserUrlIn, browserValueIn } from './security.ts';

describe('browser input', () => {
  test('allows normalized HTTP and HTTPS URLs only', async (t) => {
    const cases: [string, unknown, string | null][] = [
      ['bare host', 'example.com', 'https://example.com/'],
      ['bare localhost development server', 'localhost:3000', 'http://localhost:3000/'],
      ['bare IPv4 development server', '127.0.0.1:5173', 'http://127.0.0.1:5173/'],
      ['local development host', 'http://localhost:3000', 'http://localhost:3000/'],
      ['script URL', 'javascript:alert(1)', null],
      ['file URL', 'file:///etc/passwd', null],
      ['embedded credentials', 'https://name:secret@example.com', null],
      ['invalid value', 7, null],
    ];

    for (const [name, input, expected] of cases) {
      await t.test(name, () => {
        assert.equal(browserUrlIn(input), expected);
      });
    }
  });

  test('limits values used as page selectors and input text', () => {
    assert.equal(browserValueIn('button#submit'), 'button#submit');
    assert.equal(browserValueIn(4), null);
    assert.equal(browserValueIn('x'.repeat(10_001)), null);
  });
});
