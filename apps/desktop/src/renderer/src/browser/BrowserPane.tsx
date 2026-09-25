import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { ArrowLeft, ArrowRight, MousePointer2, RotateCw, Square } from 'lucide-react';
import * as stylex from '@stylexjs/stylex';
import { BROWSER_PROFILE_PARTITION } from '../../../preload/bridge';
import { normalizedBrowserUrl, pageLoadFailureMessage, type BrowserTab } from './state';
import {
  createElementSelectorController,
  dispatchBrowserElementSelection,
  type ElementSelectorWebview,
} from './elementSelection';
import { styles } from './styles';

interface GuestElement extends HTMLElement, ElementSelectorWebview {
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  loadURL(url: string): Promise<void>;
  getWebContentsId(): number;
}

interface BrowserBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

const browserHost = (() => {
  const existing = document.getElementById('kira-browser-surface');
  if (existing) return existing;

  const host = document.createElement('div');
  host.id = 'kira-browser-surface';
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    overflow: 'visible',
    pointerEvents: 'none',
    zIndex: '1',
  });
  document.body.appendChild(host);
  return host;
})();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BrowserPane({
  browser,
  chatId,
  active,
  onUpdate,
}: {
  browser: BrowserTab;
  chatId: string;
  active: boolean;
  onUpdate: (patch: Partial<BrowserTab>) => void;
}) {
  const [address, setAddress] = useState(browser.url);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [bounds, setBounds] = useState<BrowserBounds | null>(null);
  const [guest, setGuest] = useState<GuestElement | null>(null);
  const [picking, setPicking] = useState(false);
  const selector = useMemo(() => createElementSelectorController(), []);
  const viewportRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const update = (): void => {
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      setBounds({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  const guestRef = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const webview = element as GuestElement;
      setGuest(webview);
      const syncNavigation = (): void => {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
      };
      const updateUrl = (event: Event): void => {
        const url = (event as Event & { url?: unknown }).url;
        if (typeof url !== 'string') return;
        const safe = normalizedBrowserUrl(url);
        if (safe === null) return;
        setAddress(safe);
        setProblem(null);
        onUpdate({ url: safe });
        syncNavigation();
      };
      const updateTitle = (event: Event): void => {
        const title = (event as Event & { title?: unknown }).title;
        if (typeof title === 'string') onUpdate({ title });
      };
      const started = (): void => {
        selector.stopForWebview(webview);
        setPicking(false);
        setBusy(true);
      };
      const stopped = (): void => {
        setBusy(false);
        syncNavigation();
      };
      const failed = (event: Event): void => {
        const detail = event as Event & {
          errorCode?: unknown;
          errorDescription?: unknown;
          isMainFrame?: unknown;
        };
        const message = pageLoadFailureMessage(detail);
        if (message === null) return;
        setProblem(message);
        setBusy(false);
      };
      const attached = (): void => {
        void window.kira
          .registerBrowserGuest({
            browserId: browser.id,
            chatId,
            webContentsId: webview.getWebContentsId(),
          })
          .then((result) => {
            if (!result.ok) {
              setProblem(result.error);
              return;
            }
            if (active) void window.kira.activateBrowser(chatId, browser.id);
          });
      };

      webview.addEventListener('did-navigate', updateUrl);
      webview.addEventListener('did-navigate-in-page', updateUrl);
      webview.addEventListener('page-title-updated', updateTitle);
      webview.addEventListener('did-start-loading', started);
      webview.addEventListener('did-stop-loading', stopped);
      webview.addEventListener('did-fail-load', failed);
      webview.addEventListener('did-attach', attached);
      return () => {
        selector.stopForWebview(webview);
        webview.removeEventListener('did-navigate', updateUrl);
        webview.removeEventListener('did-navigate-in-page', updateUrl);
        webview.removeEventListener('page-title-updated', updateTitle);
        webview.removeEventListener('did-start-loading', started);
        webview.removeEventListener('did-stop-loading', stopped);
        webview.removeEventListener('did-fail-load', failed);
        webview.removeEventListener('did-attach', attached);
      };
    },
    [active, browser.id, chatId, onUpdate, selector],
  );

  const pickElement = (): void => {
    if (picking) {
      selector.cancel();
      setPicking(false);
      return;
    }
    if (!guest) return;
    const result = selector.start({
      webview: guest,
      onFinish: (selection) => {
        setPicking(false);
        if (selection) dispatchBrowserElementSelection(chatId, selection);
      },
    });
    setPicking(result === 'started');
    if (result === 'loading')
      setProblem('Wait for the page to finish loading before picking an element.');
    if (result === 'unavailable') setProblem('The page is not available for element picking.');
  };

  const go = async (): Promise<void> => {
    const url = normalizedBrowserUrl(address);
    if (url === null) {
      setProblem('Enter a valid HTTP or HTTPS address.');
      return;
    }
    setAddress(url);
    setProblem(null);
    setBusy(true);
    onUpdate({ url });
    try {
      await guest?.loadURL(url);
    } catch (error) {
      setProblem(errorMessage(error));
      setBusy(false);
    }
  };

  const viewport = bounds ?? { left: 0, top: 0, width: 1280, height: 800 };
  const surfaceStyle: CSSProperties = active
    ? {
        position: 'fixed',
        left: viewport.left,
        top: viewport.top,
        width: viewport.width,
        height: viewport.height,
        overflow: 'hidden',
        pointerEvents: 'auto',
        zIndex: '0',
      }
    : {
        position: 'fixed',
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: '0',
      };
  const guestStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: viewport.width,
    height: viewport.height,
    display: 'inline-flex',
    border: '0',
    pointerEvents: active ? 'auto' : 'none',
  };

  return (
    <>
      <div {...stylex.props(active ? styles.panel : styles.hidden)}>
        <div {...stylex.props(styles.toolbar)}>
          <IconButton
            label="Back"
            tooltip="Back"
            size="sm"
            variant="ghost"
            icon={<Icon icon={ArrowLeft} size="sm" />}
            isDisabled={!canGoBack}
            onClick={() => guest?.goBack()}
          />
          <IconButton
            label="Forward"
            tooltip="Forward"
            size="sm"
            variant="ghost"
            icon={<Icon icon={ArrowRight} size="sm" />}
            isDisabled={!canGoForward}
            onClick={() => guest?.goForward()}
          />
          <IconButton
            label={busy ? 'Stop' : 'Reload'}
            tooltip={busy ? 'Stop loading' : 'Reload'}
            size="sm"
            variant="ghost"
            icon={<Icon icon={busy ? Square : RotateCw} size="sm" />}
            onClick={() => (busy ? guest?.stop() : guest?.reload())}
          />
          <IconButton
            label={picking ? 'Cancel element selection' : 'Pick element for chat'}
            tooltip={picking ? 'Cancel element selection' : 'Pick element for chat'}
            size="sm"
            variant={picking ? 'secondary' : 'ghost'}
            icon={<Icon icon={MousePointer2} size="sm" />}
            isDisabled={!guest || busy}
            aria-pressed={picking}
            onClick={pickElement}
          />
          <form
            {...stylex.props(styles.addressForm)}
            onSubmit={(event) => {
              event.preventDefault();
              void go();
            }}
          >
            <input
              aria-label="Browser address"
              {...stylex.props(styles.address)}
              value={address}
              onChange={(event) => setAddress(event.currentTarget.value)}
            />
          </form>
          <span {...stylex.props(styles.status)} aria-live="polite">
            {busy ? 'Loading' : ''}
          </span>
        </div>
        {problem ? (
          <div {...stylex.props(styles.error)} role="alert">
            {problem}
          </div>
        ) : null}
        <div {...stylex.props(styles.viewport)} ref={viewportRef} />
      </div>
      {createPortal(
        <div style={surfaceStyle} aria-hidden={!active}>
          <webview
            ref={guestRef as React.RefCallback<HTMLElement>}
            data-browser-id={browser.id}
            src={browser.url}
            partition={BROWSER_PROFILE_PARTITION}
            style={guestStyle}
          />
        </div>,
        browserHost,
      )}
    </>
  );
}
