import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import type { Root } from 'react-dom/client';
import type { Reading } from './api/allowances';
import type { Loaded } from './api/result';

const api = {
  readAllowance: mock<() => Promise<Loaded<Reading>>>(),
  setAllowance: mock<(userId: string, tokens: number | null) => Promise<Loaded<Reading>>>(),
  readDefaultAllowance: mock<() => Promise<Loaded<number>>>(),
  setDefaultAllowance: mock<(tokensPerMonth: number) => Promise<Loaded<number>>>(),
};

mock.module('./api/allowances', () => api);
mock.module('@stylexjs/stylex', () => ({
  create: (styles: Record<string, unknown>) => styles,
  props: () => ({}),
}));

let dom: JSDOM;
let root: Root;
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let host: HTMLDivElement;
let DefaultAllowance: (typeof import('./defaultAllowance'))['default'];

beforeEach(async () => {
  mock.clearAllMocks();
  api.readDefaultAllowance.mockResolvedValue({ ok: true, value: 1_000_000 });
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
  DefaultAllowance = (await import('./defaultAllowance')).default;
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
  await act(async () => root.render(<DefaultAllowance />));
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

describe("the default allowance control", () => {
  test('shows what everyone gets and saves a new number', async () => {
    api.setDefaultAllowance.mockResolvedValue({ ok: true, value: 2_500_000 });
    await render();

    expect(host.textContent).toContain('Everyone without a number of their own gets');

    const input = host.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, '2500000');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await act(async () => button('Save').click());

    expect(api.setDefaultAllowance).toHaveBeenCalledWith(2_500_000);
  });

  test('shows the server sentence when it cannot be changed', async () => {
    api.setDefaultAllowance.mockResolvedValue({
      ok: false,
      message: 'Kira would not change the default allowance.',
    });
    await render();

    await act(async () => button('Save').click());

    expect(host.textContent).toContain('Kira would not change the default allowance.');
  });

  test('shows the server sentence when it cannot be read', async () => {
    api.readDefaultAllowance.mockResolvedValue({
      ok: false,
      message: 'Kira would not say what the default allowance is.',
    });
    await render();

    expect(host.textContent).toContain('Kira would not say what the default allowance is.');
  });
});
