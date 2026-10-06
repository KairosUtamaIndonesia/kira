import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import type { Root } from 'react-dom/client';
import type { AuditEvent } from './api/audit';
import type { Loaded } from './api/result';

const api = {
  readAudit: mock<() => Promise<Loaded<AuditEvent[]>>>(),
};

mock.module('./api/audit', () => api);
mock.module('@stylexjs/stylex', () => ({
  create: (styles: Record<string, unknown>) => styles,
  props: () => ({}),
}));

const events: AuditEvent[] = [
  {
    id: 'admin:1',
    at: '2026-10-06T10:00:00.000Z',
    actor: 'ada@company.example',
    action: 'role',
    target: 'grace@company.example',
    outcome: 'succeeded',
    detail: 'admin',
  },
  {
    id: 'pool:2',
    at: '2026-10-06T09:00:00.000Z',
    actor: 'ada@company.example',
    action: 'delete',
    target: 'codex-ada',
    outcome: 'succeeded',
    detail: null,
  },
];

let dom: JSDOM;
let root: Root;
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let host: HTMLDivElement;
let Audit: (typeof import('./audit'))['default'];

beforeEach(async () => {
  mock.clearAllMocks();
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://kira.example/admin/?page=audit',
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
  Audit = (await import('./audit')).default;
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

async function render() {
  await act(async () => root.render(<Audit />));
}

describe('the Audit screen', () => {
  test('lists admin actions and Pool changes together', async () => {
    api.readAudit.mockResolvedValue({ ok: true, value: events });

    await render();

    expect(host.textContent).toContain('role');
    expect(host.textContent).toContain('grace@company.example');
    expect(host.textContent).toContain('delete');
    expect(host.textContent).toContain('codex-ada');
  });

  test('says when nothing has been recorded', async () => {
    api.readAudit.mockResolvedValue({ ok: true, value: [] });

    await render();

    expect(host.textContent).toContain('Nothing has been recorded yet.');
  });

  test('shows the sentence when the audit cannot be read', async () => {
    api.readAudit.mockResolvedValue({ ok: false, message: 'Kira could not read the audit.' });

    await render();

    expect(host.textContent).toContain('Kira could not read the audit.');
  });
});
