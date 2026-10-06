import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import type { Reading } from './api/allowances';
import type { Who } from './api/auth';
import type { Loaded } from './api/result';
import type { ListedUser } from './api/users';

mock.module('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
  }: {
    to: string;
    params?: { id?: string };
    children: ReactNode;
  }) => <a href={to.replace('$id', params?.id ?? '')}>{children}</a>,
}));

mock.module('@stylexjs/stylex', () => ({
  create: (styles: Record<string, unknown>) => styles,
  props: () => ({}),
}));

const allowances = {
  readAllowance: mock<() => Promise<Loaded<Reading>>>(),
  setAllowance: mock<(userId: string, tokens: number | null) => Promise<Loaded<Reading>>>(),
  readDefaultAllowance: mock<() => Promise<Loaded<number>>>(),
  setDefaultAllowance: mock<(tokensPerMonth: number) => Promise<Loaded<number>>>(),
};

mock.module('./api/allowances', () => allowances);

const who: Who = {
  name: 'Ada Lovelace',
  email: 'ada@company.example',
  admin: true,
  impersonated: false,
};

const grace: ListedUser = {
  id: 'grace',
  name: 'Grace Hopper',
  email: 'grace@company.example',
  role: 'user',
  banned: false,
};

let dom: JSDOM;
let root: Root;
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let host: HTMLDivElement;
let People: (typeof import('./people'))['default'];
let ConsoleDataProvider: (typeof import('./consoleData'))['ConsoleDataProvider'];

beforeEach(async () => {
  mock.clearAllMocks();
  allowances.readDefaultAllowance.mockResolvedValue({ ok: true, value: 1_000_000 });
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://kira.example/admin/',
    pretendToBeVisual: true,
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Node: dom.window.Node,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  host = dom.window.document.querySelector<HTMLDivElement>('#root')!;
  root = createRoot(host);
  People = (await import('./people')).default;
  ({ ConsoleDataProvider } = await import('./consoleData'));
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
  Reflect.deleteProperty(globalThis, 'navigator');
  Reflect.deleteProperty(globalThis, 'HTMLElement');
  Reflect.deleteProperty(globalThis, 'HTMLInputElement');
  Reflect.deleteProperty(globalThis, 'Node');
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

async function render() {
  const value = {
    who,
    users: [grace],
    readings: {
      grace: {
        ok: true as const,
        value: { allowance: 1_000_000, used: 0, warned: false, override: null, refusals: [] },
      },
    },
    updateUser: mock(),
  };

  await act(async () =>
    root.render(
      <ConsoleDataProvider value={value}>
        <People />
      </ConsoleDataProvider>,
    ),
  );
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

describe('the People table', () => {
  test('lists a person and links their row to their page', async () => {
    await render();

    expect(host.textContent).toContain('Grace Hopper');
    expect(host.querySelector('a[href="/users/grace"]')?.textContent).toContain('Grace Hopper');
  });

  test('moves every override-less row when the default allowance changes', async () => {
    allowances.setDefaultAllowance.mockResolvedValue({ ok: true, value: 2_000_000 });
    await render();
    expect(host.textContent).toContain('0 of 1.0M');

    const input = host.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, '2000000');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await act(async () => button('Save').click());

    expect(host.textContent).toContain('0 of 2.0M');
  });
});
