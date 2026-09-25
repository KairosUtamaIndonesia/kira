import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  browserElementSelectionForChat,
  browserElementSelectionFrom,
  browserElementsInMessage,
  createElementSelectorController,
  describeBrowserElement,
  formatBrowserElementDraft,
  type BrowserElementSelection,
  type ElementSelectorRuntime,
  type ElementSelectorWebview,
} from './elementSelection.ts';

const selection: BrowserElementSelection = {
  url: 'https://example.test/form',
  selector: '#submit',
  tag: 'button',
  text: 'Submit',
  outerHTML: '<button id="submit">Submit</button>',
  boundingRect: { x: 10, y: 20, width: 80, height: 30 },
};

describe('browser element drafts', () => {
  test('shows a concise label and formats element context as ordinary message text', () => {
    assert.equal(
      describeBrowserElement(selection),
      'Element · button “Submit” · #submit · example.test',
    );
    assert.equal(
      formatBrowserElementDraft(selection),
      [
        '<browser-element url="https://example.test/form">',
        '  selector: "#submit"',
        '  tag: "button"',
        '  text: "Submit"',
        '  size: 80x30',
        '  html: "<button id=\\"submit\\">Submit</button>"',
        '</browser-element>',
      ].join('\n'),
    );
  });

  test('routes the structured selection only to its owning chat', () => {
    assert.deepEqual(
      browserElementSelectionForChat({ chatId: 'chat-a', selection }, 'chat-a'),
      selection,
    );
    assert.equal(browserElementSelectionForChat({ chatId: 'chat-b', selection }, 'chat-a'), null);
  });

  test('keeps instructions first and adds element details as ordinary message text', () => {
    assert.equal(
      browserElementsInMessage('Please inspect this control.', [selection]),
      [
        'Please inspect this control.',
        '',
        '<browser-element url="https://example.test/form">',
        '  selector: "#submit"',
        '  tag: "button"',
        '  text: "Submit"',
        '  size: 80x30',
        '  html: "<button id=\\"submit\\">Submit</button>"',
        '</browser-element>',
      ].join('\n'),
    );
  });

  test('formats a selected element as bounded chat context', () => {
    assert.equal(
      formatBrowserElementDraft(selection),
      [
        '<browser-element url="https://example.test/form">',
        '  selector: "#submit"',
        '  tag: "button"',
        '  text: "Submit"',
        '  size: 80x30',
        '  html: "<button id=\\"submit\\">Submit</button>"',
        '</browser-element>',
      ].join('\n'),
    );
  });

  test('keeps selected page text and markup within the composer limit', () => {
    const draft = formatBrowserElementDraft({
      ...selection,
      text: 'x'.repeat(300),
      outerHTML: '<p>' + 'x'.repeat(1_000) + '</p>',
    });

    const textLine = draft.split('\n').find((line) => line.startsWith('  text: '));
    const htmlLine = draft.split('\n').find((line) => line.startsWith('  html: '));
    assert.equal(textLine?.length, '  text: '.length + 202);
    assert.equal(htmlLine?.length, '  html: '.length + 802);
  });

  test('accepts a valid selection only for its owning chat', () => {
    const cases = [
      {
        name: 'matching chat',
        detail: { chatId: 'chat-a', selection },
        want: selection,
      },
      {
        name: 'another chat',
        detail: { chatId: 'chat-b', selection },
        want: null,
      },
      { name: 'invalid payload', detail: { chatId: 'chat-a', selection: 12 }, want: null },
    ] as const;

    for (const testCase of cases) {
      assert.deepEqual(
        browserElementSelectionForChat(testCase.detail, 'chat-a'),
        testCase.want,
        testCase.name,
      );
    }
  });

  test('rejects malformed or unsafe data returned from the page', () => {
    const cases = [
      { name: 'valid selection', value: selection, want: selection },
      { name: 'script URL', value: { ...selection, url: 'javascript:alert(1)' }, want: null },
      {
        name: 'oversized markup',
        value: { ...selection, outerHTML: 'x'.repeat(2_001) },
        want: null,
      },
      {
        name: 'invalid bounds',
        value: { ...selection, boundingRect: { ...selection.boundingRect, width: Number.NaN } },
        want: null,
      },
    ] as const;

    for (const testCase of cases) {
      assert.deepEqual(browserElementSelectionFrom(testCase.value), testCase.want, testCase.name);
    }
  });
});

describe('element selector lifecycle', () => {
  test('returns the selected element and stops watching', async () => {
    let installed: ((state: 'installed' | 'loading' | 'unavailable') => void) | undefined;
    let selected: ((value: BrowserElementSelection | null) => void) | undefined;
    let stopped = 0;
    let cancelledTimeout = 0;
    const runtime: ElementSelectorRuntime = {
      token: () => 'selection-1',
      install: () =>
        new Promise((resolve) => {
          installed = resolve;
        }),
      watch: (_webview, _token, onResult) => {
        selected = onResult;
        return () => {
          stopped++;
        };
      },
      clear: () => {},
      destroy: () => {},
      timeout: () => 1,
      cancelTimeout: () => {
        cancelledTimeout++;
      },
    };
    const webview = { isConnected: true, isLoading: () => false } as ElementSelectorWebview;
    const outcomes: (BrowserElementSelection | null)[] = [];
    const controller = createElementSelectorController(runtime);

    assert.equal(
      controller.start({ webview, onFinish: (value) => outcomes.push(value) }),
      'started',
    );
    installed?.('installed');
    await Promise.resolve();
    await Promise.resolve();
    selected?.(selection);

    assert.deepEqual(outcomes, [selection]);
    assert.equal(stopped, 1);
    assert.equal(cancelledTimeout, 1);
  });

  test('cancels a late-installed selector after Escape or navigation', async () => {
    let installed: ((state: 'installed' | 'loading' | 'unavailable') => void) | undefined;
    let destroyed = 0;
    let cleared = 0;
    const runtime: ElementSelectorRuntime = {
      token: () => 'selection-1',
      install: () =>
        new Promise((resolve) => {
          installed = resolve;
        }),
      watch: () => () => {},
      clear: () => {
        cleared++;
      },
      destroy: () => {
        destroyed++;
      },
      timeout: () => 1,
      cancelTimeout: () => {},
    };
    const webview = { isConnected: true, isLoading: () => false } as ElementSelectorWebview;
    const outcomes: (BrowserElementSelection | null)[] = [];
    const controller = createElementSelectorController(runtime);

    controller.start({ webview, onFinish: (value) => outcomes.push(value) });
    controller.stopForWebview(webview);
    installed?.('installed');
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(outcomes, [null]);
    assert.equal(cleared, 0);
    assert.equal(destroyed, 2);
  });

  test('destroys the page selector when its timeout expires', async () => {
    let expire: (() => void) | undefined;
    let destroyed = 0;
    const runtime: ElementSelectorRuntime = {
      token: () => 'selection-1',
      install: async () => 'installed',
      watch: () => () => {},
      clear: () => {},
      destroy: () => {
        destroyed++;
      },
      timeout: (callback) => {
        expire = callback;
        return 1;
      },
      cancelTimeout: () => {},
    };
    const webview = { isConnected: true, isLoading: () => false } as ElementSelectorWebview;
    const outcomes: (BrowserElementSelection | null)[] = [];
    const controller = createElementSelectorController(runtime);

    controller.start({ webview, onFinish: (value) => outcomes.push(value) });
    await Promise.resolve();
    await Promise.resolve();
    expire?.();

    assert.deepEqual(outcomes, [null]);
    assert.equal(destroyed, 1);
  });
});
