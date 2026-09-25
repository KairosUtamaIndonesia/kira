export interface BrowserElementSelection {
  url: string;
  selector: string;
  tag: string;
  text: string;
  outerHTML: string;
  boundingRect: { x: number; y: number; width: number; height: number };
}

export function browserElementSelectionFrom(value: unknown): BrowserElementSelection | null {
  if (typeof value !== 'object' || value === null) return null;
  const url = Reflect.get(value, 'url');
  const selector = Reflect.get(value, 'selector');
  const tag = Reflect.get(value, 'tag');
  const text = Reflect.get(value, 'text');
  const outerHTML = Reflect.get(value, 'outerHTML');
  const boundingRect = Reflect.get(value, 'boundingRect');
  if (
    typeof url !== 'string' ||
    url.length > 4_096 ||
    typeof selector !== 'string' ||
    selector.length > 4_000 ||
    typeof tag !== 'string' ||
    !/^[a-z][a-z\d-]*$/i.test(tag) ||
    typeof text !== 'string' ||
    text.length > 500 ||
    typeof outerHTML !== 'string' ||
    outerHTML.length > 2_000 ||
    typeof boundingRect !== 'object' ||
    boundingRect === null
  ) {
    return null;
  }
  try {
    const parsedUrl = new URL(url);
    if (
      (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') ||
      !parsedUrl.hostname ||
      parsedUrl.username ||
      parsedUrl.password
    ) {
      return null;
    }
  } catch {
    return null;
  }
  const rect = {
    x: Reflect.get(boundingRect, 'x'),
    y: Reflect.get(boundingRect, 'y'),
    width: Reflect.get(boundingRect, 'width'),
    height: Reflect.get(boundingRect, 'height'),
  };
  if (
    Object.values(rect).some(
      (coordinate) =>
        typeof coordinate !== 'number' ||
        !Number.isFinite(coordinate) ||
        Math.abs(coordinate) > 10_000_000,
    ) ||
    (rect.width as number) < 0 ||
    (rect.height as number) < 0
  ) {
    return null;
  }
  return {
    url,
    selector,
    tag,
    text,
    outerHTML,
    boundingRect: rect as BrowserElementSelection['boundingRect'],
  };
}

const SELECTOR_TIMEOUT_MS = 30_000;

export interface ElementSelectorWebview {
  readonly isConnected: boolean;
  isLoading(): boolean;
  executeJavaScript(code: string): Promise<unknown>;
}

export interface ElementSelectorRuntime {
  token(): string;
  install(
    webview: ElementSelectorWebview,
    token: string,
  ): Promise<'installed' | 'loading' | 'unavailable'>;
  watch(
    webview: ElementSelectorWebview,
    token: string,
    onResult: (selection: BrowserElementSelection | null) => void,
  ): () => void;
  clear(webview: ElementSelectorWebview, token: string): void;
  destroy(webview: ElementSelectorWebview, token: string): void;
  timeout(callback: () => void): number;
  cancelTimeout(timeoutId: number): void;
}

interface Session {
  token: string;
  webview: ElementSelectorWebview;
  onFinish: (result: BrowserElementSelection | null) => void;
  stopWatching?: () => void;
  timeoutId?: number;
}

export interface ElementSelectorController {
  start(input: {
    webview: ElementSelectorWebview;
    onFinish: (result: BrowserElementSelection | null) => void;
  }): 'started' | 'loading' | 'unavailable';
  cancel(): void;
  stopForWebview(webview: ElementSelectorWebview): void;
}

function execute(webview: ElementSelectorWebview, code: string): Promise<unknown> {
  if (!webview.isConnected) return Promise.resolve(null);
  try {
    return webview.executeJavaScript(code);
  } catch (error) {
    return Promise.reject(error);
  }
}

function selectorScript(token: string): string {
  return `(() => {
    const token = ${JSON.stringify(token)};
    if (document.readyState === 'loading' || !document.documentElement) {
      return { token, state: 'loading' };
    }
    window.__kiraElementSelector?.destroy();
    window.__kiraElementSelection = null;
    const style = document.createElement('style');
    style.textContent = '.__kira-pick-hover { outline: 2px solid #3b82f6 !important; outline-offset: 2px !important; cursor: crosshair !important; }';
    document.head?.appendChild(style);
    const label = document.createElement('div');
    Object.assign(label.style, {
      position: 'fixed', zIndex: '2147483647', pointerEvents: 'none',
      padding: '4px 8px', borderRadius: '4px', background: '#18181b',
      color: 'white', font: '12px ui-monospace, monospace', maxWidth: '320px',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
    });
    label.hidden = true;
    document.documentElement.appendChild(label);
    let hovered = null;
    const describe = (element) => {
      if (element.id) return '#' + CSS.escape(element.id);
      const parts = [];
      let current = element;
      while (current && current.nodeType === 1) {
        let part = current.tagName.toLowerCase();
        let index = 1;
        for (let sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
          if (sibling.tagName === current.tagName) index++;
        }
        if (index > 1) part += ':nth-of-type(' + index + ')';
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };
    const move = (event) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element || element === label || label.contains(element)) return;
      hovered?.classList.remove('__kira-pick-hover');
      hovered = element;
      element.classList.add('__kira-pick-hover');
      label.textContent = describe(element);
      label.hidden = false;
      label.style.left = Math.min(event.clientX + 12, innerWidth - 330) + 'px';
      label.style.top = Math.min(event.clientY + 12, innerHeight - 32) + 'px';
    };
    const block = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const click = (event) => {
      block(event);
      const element = event.target instanceof Element ? event.target : hovered;
      if (!element || element === label || label.contains(element)) return;
      const rect = element.getBoundingClientRect();
      window.__kiraElementSelection = {
        token,
        selection: {
          url: location.href,
          selector: describe(element),
          tag: element.tagName.toLowerCase(),
          text: (element.textContent || '').trim().slice(0, 500),
          outerHTML: element.outerHTML.slice(0, 2000),
          boundingRect: {
            x: Math.round(rect.x), y: Math.round(rect.y),
            width: Math.round(rect.width), height: Math.round(rect.height)
          }
        }
      };
      destroy();
    };
    const keydown = (event) => {
      if (event.key !== 'Escape') return;
      block(event);
      window.__kiraElementSelection = { token, cancelled: true };
      destroy();
    };
    const destroy = () => {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('pointerdown', block, true);
      document.removeEventListener('keydown', keydown, true);
      hovered?.classList.remove('__kira-pick-hover');
      label.remove();
      style.remove();
      if (window.__kiraElementSelector?.token === token) {
        window.__kiraElementSelector = null;
      }
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('pointerdown', block, true);
    document.addEventListener('keydown', keydown, true);
    window.__kiraElementSelector = { token, destroy };
    return { token, state: 'installed' };
  })()`;
}

function browserSelectorRuntime(): ElementSelectorRuntime {
  let sequence = 0;
  return {
    token: () => `${++sequence}:${crypto.randomUUID()}`,
    async install(webview, token) {
      const result = await execute(webview, selectorScript(token));
      if (!result || typeof result !== 'object' || Reflect.get(result, 'token') !== token) {
        return 'unavailable';
      }
      if (Reflect.get(result, 'state') === 'installed') return 'installed';
      return Reflect.get(result, 'state') === 'loading' ? 'loading' : 'unavailable';
    },
    watch(webview, token, onResult) {
      let stopped = false;
      let timer: number | undefined;
      const poll = (): void => {
        void (async () => {
          try {
            const value = await execute(
              webview,
              `JSON.stringify(window.__kiraElementSelection?.token === ${JSON.stringify(token)} ? window.__kiraElementSelection : null)`,
            );
            const result = typeof value === 'string' ? JSON.parse(value) : null;
            if (!result) {
              if (!stopped) timer = window.setTimeout(poll, 200);
              return;
            }
            stopped = true;
            onResult(
              result.cancelled === true ? null : browserElementSelectionFrom(result.selection),
            );
          } catch {
            if (!stopped) timer = window.setTimeout(poll, 200);
          }
        })();
      };
      timer = window.setTimeout(poll, 200);
      return () => {
        stopped = true;
        if (timer !== undefined) window.clearTimeout(timer);
      };
    },
    clear(webview, token) {
      void execute(
        webview,
        `if (window.__kiraElementSelector?.token === ${JSON.stringify(token)}) window.__kiraElementSelector.destroy(); if (window.__kiraElementSelection?.token === ${JSON.stringify(token)}) window.__kiraElementSelection = null;`,
      ).catch(() => {});
    },
    destroy(webview, token) {
      void execute(
        webview,
        `if (window.__kiraElementSelector?.token === ${JSON.stringify(token)}) window.__kiraElementSelector.destroy();`,
      ).catch(() => {});
    },
    timeout: (callback) => window.setTimeout(callback, SELECTOR_TIMEOUT_MS),
    cancelTimeout: (id) => window.clearTimeout(id),
  };
}

export function createElementSelectorController(
  runtime: ElementSelectorRuntime = browserSelectorRuntime(),
): ElementSelectorController {
  let current: Session | null = null;

  const finish = (
    session: Session,
    result: BrowserElementSelection | null,
    cleanup: 'clear' | 'destroy' | null,
  ): void => {
    if (current !== session) return;
    current = null;
    session.stopWatching?.();
    if (session.timeoutId !== undefined) runtime.cancelTimeout(session.timeoutId);
    if (cleanup) runtime[cleanup](session.webview, session.token);
    session.onFinish(result);
  };

  const install = async (session: Session): Promise<void> => {
    let state: 'installed' | 'loading' | 'unavailable';
    try {
      state = await runtime.install(session.webview, session.token);
    } catch {
      state = 'unavailable';
    }
    if (current !== session) {
      if (state === 'installed') runtime.destroy(session.webview, session.token);
      return;
    }
    if (state !== 'installed') {
      finish(session, null, null);
      return;
    }
    session.stopWatching = runtime.watch(session.webview, session.token, (selection) =>
      finish(session, selection, null),
    );
  };

  return {
    start({ webview, onFinish }) {
      if (!webview.isConnected) return 'unavailable';
      if (webview.isLoading()) return 'loading';
      if (current) finish(current, null, 'clear');
      const session: Session = { token: runtime.token(), webview, onFinish };
      current = session;
      session.timeoutId = runtime.timeout(() => finish(session, null, 'destroy'));
      void install(session);
      return 'started';
    },
    cancel() {
      if (current) finish(current, null, 'clear');
    },
    stopForWebview(webview) {
      if (current?.webview === webview) finish(current, null, 'destroy');
    },
  };
}

export function formatBrowserElementDraft(selection: BrowserElementSelection): string {
  const text = selection.text.trim();
  const html = selection.outerHTML.trim();
  return [
    `<browser-element url=${JSON.stringify(selection.url)}>`,
    `  selector: ${JSON.stringify(selection.selector)}`,
    `  tag: ${JSON.stringify(selection.tag)}`,
    ...(text ? [`  text: ${JSON.stringify(text.slice(0, 200))}`] : []),
    `  size: ${selection.boundingRect.width}x${selection.boundingRect.height}`,
    `  html: ${JSON.stringify(html.slice(0, 800))}`,
    '</browser-element>',
  ].join('\n');
}

export function describeBrowserElement(selection: BrowserElementSelection): string {
  const text = selection.text.trim().replace(/\s+/g, ' ');
  const shortText = text.length > 40 ? `${text.slice(0, 39)}…` : text;
  const name = shortText ? ` “${shortText}”` : '';
  const selector =
    selection.selector.length > 48 ? `${selection.selector.slice(0, 47)}…` : selection.selector;
  return `Element · ${selection.tag}${name} · ${selector} · ${new URL(selection.url).hostname}`;
}

export function browserElementsInMessage(
  text: string,
  selections: readonly BrowserElementSelection[],
): string {
  const context = selections.map(formatBrowserElementDraft).join('\n\n');
  return [text.trimEnd(), context].filter((part) => part.trim()).join('\n\n');
}

export function browserElementSelectionForChat(
  detail: unknown,
  chatId: string,
): BrowserElementSelection | null {
  if (typeof detail !== 'object' || detail === null || Reflect.get(detail, 'chatId') !== chatId) {
    return null;
  }
  return browserElementSelectionFrom(Reflect.get(detail, 'selection'));
}

export const BROWSER_ELEMENT_SELECTION_EVENT = 'kira:browser-element-selection';

export function dispatchBrowserElementSelection(
  chatId: string,
  selection: BrowserElementSelection,
): void {
  window.dispatchEvent(
    new CustomEvent(BROWSER_ELEMENT_SELECTION_EVENT, { detail: { chatId, selection } }),
  );
}
