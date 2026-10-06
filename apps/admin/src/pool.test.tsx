import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { Loaded } from './api/result';
import type {
  CredentialActionResult,
  OAuthCancellation,
  OAuthProgress,
  OAuthProvider,
  OAuthState,
  PoolAuditEvent,
  PoolCredential,
  PoolReading,
} from './api/pool';

const api = {
  readPool: mock<() => Promise<Loaded<PoolReading>>>(),
  readPoolAudit: mock<() => Promise<Loaded<PoolAuditEvent[]>>>(),
  readPoolLogin: mock<(state: string) => Promise<Loaded<OAuthProgress>>>(),
  startPoolLogin: mock<(provider: OAuthProvider) => Promise<Loaded<OAuthState>>>(),
  relayPoolCallback:
    mock<
      (
        provider: OAuthProvider,
        redirectUrl: string,
      ) => Promise<Loaded<{ status: 'accepted' | 'unconfigured' | 'rejected' | 'unavailable' }>>
    >(),
  cancelPoolLogin: mock<(state: string) => Promise<Loaded<OAuthCancellation>>>(),
  setCredentialDisabled:
    mock<(id: string, disabled: boolean) => Promise<Loaded<CredentialActionResult>>>(),
  refreshCredential: mock<(id: string) => Promise<Loaded<CredentialActionResult>>>(),
  deleteCredential: mock<(id: string) => Promise<Loaded<CredentialActionResult>>>(),
};

mock.module('./api/pool', () => api);
mock.module('@stylexjs/stylex', () => ({
  create: (styles: Record<string, unknown>) => styles,
  props: () => ({}),
}));

const ready: PoolReading = { status: 'ready', credentials: [] };
const credential: PoolCredential = {
  id: 'codex-ada',
  name: 'codex-ada.json',
  provider: 'codex',
  label: null,
  email: 'ada@company.example',
  status: 'active',
  disabled: false,
  unavailable: false,
  nextRetryAfter: null,
  cooldowns: [],
  quota: null,
};

let dom: JSDOM;
let root: Root;
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let host: HTMLDivElement;
let Pool: (typeof import('./pool'))['default'];

beforeEach(async () => {
  mock.clearAllMocks();
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
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  host = dom.window.document.querySelector<HTMLDivElement>('#root')!;
  root = createRoot(host);
  Pool = (await import('./pool')).default;

  api.readPool.mockResolvedValue({ ok: true, value: ready });
  api.readPoolAudit.mockResolvedValue({ ok: true, value: [] });
  api.readPoolLogin.mockResolvedValue({ ok: true, value: { status: 'pending' } });
  api.startPoolLogin.mockResolvedValue({
    ok: true,
    value: {
      status: 'pending',
      provider: 'codex',
      url: 'https://provider.example/authorize',
      state: 'oauth-state',
    },
  });
  api.relayPoolCallback.mockResolvedValue({ ok: true, value: { status: 'accepted' } });
  api.cancelPoolLogin.mockResolvedValue({ ok: true, value: { status: 'cancelled' } });
  api.setCredentialDisabled.mockResolvedValue({ ok: true, value: { status: 'succeeded' } });
  api.refreshCredential.mockResolvedValue({ ok: true, value: { status: 'succeeded' } });
  api.deleteCredential.mockResolvedValue({ ok: true, value: { status: 'succeeded' } });
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

async function render(credentials: PoolCredential[] = []) {
  api.readPool.mockResolvedValue({ ok: true, value: { status: 'ready', credentials } });
  await act(async () => root.render(<Pool />));
}

function button(label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

describe('Pool admin interactions', () => {
  test('starts Codex OAuth, relays the pasted callback, and shows the pending result', async () => {
    await render();
    await click('Add Codex login');

    expect(
      host.querySelector('a[href="https://provider.example/authorize"]')?.textContent,
    ).toContain('Codex');
    const input = host.querySelector<HTMLInputElement>('#pool-oauth-callback')!;
    const callback = 'http://localhost:1455/auth/callback?code=one-time-code&state=oauth-state';
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, callback);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    expect(input.value).toBe(callback);
    expect(button('Submit callback').disabled).toBe(false);
    await click('Submit callback');

    expect(api.startPoolLogin).toHaveBeenCalledWith('codex');
    expect(api.relayPoolCallback).toHaveBeenCalledWith('codex', callback);
    expect(host.textContent).toContain(
      'Callback received. Waiting for the provider to finish sign-in.',
    );
    expect(input.value).toBe('');
  });

  test('cancels an active OAuth flow and makes its result visible', async () => {
    await render();
    await click('Add Claude login');
    await click('Cancel login');

    expect(api.startPoolLogin).toHaveBeenCalledWith('claude');
    expect(api.cancelPoolLogin).toHaveBeenCalledWith('oauth-state');
    expect(host.textContent).toContain('Provider login cancelled.');
    expect(host.textContent).not.toContain('Waiting for provider confirmation');
  });

  test('shows a pool management rejection and disables further add-login actions', async () => {
    api.readPool.mockResolvedValue({ ok: true, value: { status: 'rejected', credentials: [] } });
    await act(async () => root.render(<Pool />));

    expect(host.textContent).toContain('Kira has stopped management requests');
    expect(button('Add Codex login').disabled).toBe(true);
    expect(button('Add Claude login').disabled).toBe(true);
  });

  test('refreshes Pool health on the 30-second cadence while the view is open', async () => {
    const interval = dom.window.setInterval.bind(dom.window);
    const delays: number[] = [];
    dom.window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout !== undefined) delays.push(timeout);
      return interval(handler, timeout, ...args);
    }) as typeof dom.window.setInterval;
    await render();

    expect(delays).toContain(30_000);
  });

  test('reports an expired OAuth session and explains how to restart', async () => {
    api.readPoolLogin.mockResolvedValue({ ok: true, value: { status: 'expired' } });
    await render();
    await click('Add Codex login');

    expect(api.readPoolLogin).toHaveBeenCalledWith('oauth-state');
    expect(host.textContent).toContain(
      'This provider login expired. Start a new login to try again.',
    );
    expect(host.querySelector('input#pool-oauth-callback')).toBeNull();
  });

  test('enables, refreshes, and deletes a named credential with an explicit confirmation', async () => {
    await render([credential]);
    await click('Disable');
    expect(api.setCredentialDisabled).toHaveBeenCalledWith('codex-ada', true);
    expect(host.textContent).toContain('ada@company.example disabled.');

    await click('Refresh');
    expect(api.refreshCredential).toHaveBeenCalledWith('codex-ada');
    expect(host.textContent).toContain('Refresh requested for ada@company.example.');

    const confirm = mock(() => true);
    dom.window.confirm = confirm;
    await click('Delete');
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('ada@company.example'));
    expect(api.deleteCredential).toHaveBeenCalledWith('codex-ada');
    expect(host.textContent).toContain('ada@company.example deleted.');
    expect(api.readPool).toHaveBeenCalledTimes(4);
    expect(api.readPoolAudit).toHaveBeenCalledTimes(4);
  });

  test('does not delete when the account-specific confirmation is cancelled', async () => {
    await render([credential]);
    const confirm = mock(() => false);
    dom.window.confirm = confirm;
    await click('Delete');

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('ada@company.example'));
    expect(api.deleteCredential).not.toHaveBeenCalled();
    expect(api.readPool).toHaveBeenCalledTimes(1);
  });

  test('re-enables a disabled credential and communicates the result', async () => {
    await render([{ ...credential, disabled: true }]);
    await click('Enable');

    expect(api.setCredentialDisabled).toHaveBeenCalledWith('codex-ada', false);
    expect(host.textContent).toContain('ada@company.example enabled.');
  });
});
