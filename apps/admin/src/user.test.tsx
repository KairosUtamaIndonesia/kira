import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import type { Root } from 'react-dom/client';
import type { Who } from './api/auth';
import type { Loaded } from './api/result';
import type { ListedUser, ConsoleSession, DeviceKey } from './api/users';

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
  readSessions: mock<() => Promise<Loaded<ConsoleSession[]>>>(),
  revokeSession: mock<(userId: string, sessionId: string) => Promise<Loaded<{ id: string }>>>(),
  revokeSessions: mock<(userId: string) => Promise<Loaded<{ id: string }>>>(),
  readKeys: mock<() => Promise<Loaded<DeviceKey[]>>>(),
  revokeKey: mock<(userId: string, keyId: string) => Promise<Loaded<{ id: string }>>>(),
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
  api.readSessions.mockResolvedValue({ ok: true, value: [] });
  api.readKeys.mockResolvedValue({ ok: true, value: [] });
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

describe('the User page sessions', () => {
  const session: ConsoleSession = {
    id: 'session-1',
    createdAt: '2026-10-06T09:00:00.000Z',
    expiresAt: '2027-01-04T09:00:00.000Z',
    ipAddress: '203.0.113.7',
    userAgent: 'Mozilla/5.0',
  };

  test('lists the console sessions and signs one out', async () => {
    api.readSessions.mockResolvedValueOnce({ ok: true, value: [session] });
    api.revokeSession.mockResolvedValue({ ok: true, value: { id: 'session-1' } });
    await render('user');

    expect(host.textContent).toContain('Mozilla/5.0');
    await act(async () => button('Sign out').click());

    expect(api.revokeSession).toHaveBeenCalledWith('grace', 'session-1');
    expect(api.readSessions).toHaveBeenCalledTimes(2);
  });

  test('signs a person out everywhere', async () => {
    api.readSessions.mockResolvedValue({ ok: true, value: [session] });
    api.revokeSessions.mockResolvedValue({ ok: true, value: { id: 'grace' } });
    await render('user');

    await act(async () => button('Sign out everywhere').click());

    expect(api.revokeSessions).toHaveBeenCalledWith('grace');
  });

  test('shows the server sentence when sessions cannot be read', async () => {
    api.readSessions.mockResolvedValue({
      ok: false,
      message: "Kira could not read this person's sessions.",
    });
    await render('user');

    expect(host.textContent).toContain("Kira could not read this person's sessions.");
  });
});

describe('the User page Keys', () => {
  const key: DeviceKey = {
    id: 'key-1',
    name: 'workstation',
    createdAt: '2026-10-01T09:00:00.000Z',
    lastUsedAt: '2026-10-05T09:00:00.000Z',
    expiresAt: '2026-12-30T09:00:00.000Z',
  };

  test("lists a person's Keys and revokes one", async () => {
    api.readKeys.mockResolvedValueOnce({ ok: true, value: [key] });
    api.revokeKey.mockResolvedValue({ ok: true, value: { id: 'key-1' } });
    await render('user');

    expect(host.textContent).toContain('workstation');
    await act(async () => button('Revoke').click());

    expect(api.revokeKey).toHaveBeenCalledWith('grace', 'key-1');
    expect(api.readKeys).toHaveBeenCalledTimes(2);
  });
});
