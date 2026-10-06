import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import type { Root } from 'react-dom/client';
import type { Who } from './api/auth';
import type { Loaded } from './api/result';
import type { ListedUser } from './api/users';

const api = {
  setRole:
    mock<
      (userId: string, role: 'admin' | 'user') => Promise<Loaded<{ id: string; role: string }>>
    >(),
  setSuspended:
    mock<
      (
        userId: string,
        suspended: boolean,
        reason?: string,
      ) => Promise<Loaded<{ id: string; suspended: boolean }>>
    >(),
};

mock.module('./api/users', () => api);
mock.module('@stylexjs/stylex', () => ({
  create: (styles: Record<string, unknown>) => styles,
  props: () => ({}),
}));

const who: Who = { name: 'Ada Lovelace', email: 'ada@company.example', admin: true };

function person(role: string, banned = false): ListedUser {
  return { id: 'grace', name: 'Grace Hopper', email: 'grace@company.example', role, banned };
}

let dom: JSDOM;
let root: Root;
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let host: HTMLDivElement;
let User: (typeof import('./user'))['default'];
let ConsoleDataProvider: (typeof import('./consoleData'))['ConsoleDataProvider'];

beforeEach(async () => {
  mock.clearAllMocks();
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://kira.example/admin/users/grace',
    pretendToBeVisual: true,
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  host = dom.window.document.querySelector<HTMLDivElement>('#root')!;
  root = createRoot(host);
  User = (await import('./user')).default;
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
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

async function render(role: string, banned = false, updateUser = mock()) {
  const value = { who, users: [person(role, banned)], readings: {}, updateUser };
  await act(async () =>
    root.render(
      <ConsoleDataProvider value={value}>
        <User userId="grace" />
      </ConsoleDataProvider>,
    ),
  );

  return updateUser;
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

async function type(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

describe('the User page role control', () => {
  test('grants the admin role and applies the answer', async () => {
    api.setRole.mockResolvedValue({ ok: true, value: { id: 'grace', role: 'admin' } });
    const updateUser = await render('user');

    await act(async () => button('Make admin').click());

    expect(api.setRole).toHaveBeenCalledWith('grace', 'admin');
    expect(updateUser).toHaveBeenCalledWith({ id: 'grace', role: 'admin' });
  });

  test('removes the admin role', async () => {
    api.setRole.mockResolvedValue({ ok: true, value: { id: 'grace', role: 'user' } });
    await render('admin');

    await act(async () => button('Remove admin').click());

    expect(api.setRole).toHaveBeenCalledWith('grace', 'user');
  });

  test('shows the server sentence when the last admin is refused', async () => {
    api.setRole.mockResolvedValue({
      ok: false,
      message: 'Kira would be left with no administrator. Grant the role to somebody else first.',
    });
    await render('admin');

    await act(async () => button('Remove admin').click());

    expect(host.textContent).toContain('Kira would be left with no administrator.');
  });
});

describe('the User page access control', () => {
  test('suspends with an optional reason and applies the answer', async () => {
    api.setSuspended.mockResolvedValue({ ok: true, value: { id: 'grace', suspended: true } });
    const updateUser = await render('user');

    await act(async () => button('Suspend').click());
    await type('#suspend-reason', 'left the company');
    await act(async () => button('Suspend').click());

    expect(api.setSuspended).toHaveBeenCalledWith('grace', true, 'left the company');
    expect(updateUser).toHaveBeenCalledWith({ id: 'grace', banned: true });
  });

  test('reactivates a suspended person', async () => {
    api.setSuspended.mockResolvedValue({ ok: true, value: { id: 'grace', suspended: false } });
    await render('user', true);

    await act(async () => button('Reactivate').click());

    expect(api.setSuspended).toHaveBeenCalledWith('grace', false, undefined);
  });

  test('shows the server sentence when the last admin cannot be suspended', async () => {
    api.setSuspended.mockResolvedValue({
      ok: false,
      message: 'Kira would be left with no administrator.',
    });
    await render('admin');

    await act(async () => button('Suspend').click());
    await act(async () => button('Suspend').click());

    expect(host.textContent).toContain('Kira would be left with no administrator.');
  });
});
