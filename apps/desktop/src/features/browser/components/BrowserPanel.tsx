import type { UnlistenFn } from "@tauri-apps/api/event";
import type { IDockviewPanelProps } from "dockview-react";

import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { updateBrowserPanelUrl } from "@/features/projects/api/projectsApi";

import {
  goBackBrowserPanel,
  goForwardBrowserPanel,
  hideBrowserPanel,
  listenToBrowserPanel,
  navigateBrowserPanel,
  openBrowserPanel,
  reloadBrowserPanel,
  setBrowserPanelBounds,
} from "../api/browserApi";
import { useBrowserOverlayActive } from "../browserOverlayStore";

type BrowserPanelParams = {
  panelId: string;
  url: string;
};

// The Browser Panel renders only chrome (toolbar) plus an empty viewport region. The live
// website is a native child webview (owned by the Rust backend) floating above the viewport
// rect; this component keeps that webview positioned, visible, and navigated. The webview
// survives tab switches, so unmount hides it rather than destroying it — deletion closes it
// via the workspace's onDidRemovePanel handler.
function BrowserPanel({ api, params }: IDockviewPanelProps<BrowserPanelParams>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef(params.url);
  const [address, setAddress] = useState(params.url);

  const viewportBounds = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    const rect = viewport.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }, []);

  // Ensure the webview exists, is visible, and covers the viewport region.
  const showAtViewport = useCallback(() => {
    const bounds = viewportBounds();
    if (bounds === undefined) {
      return;
    }
    void openBrowserPanel(params.panelId, urlRef.current, bounds);
  }, [params.panelId, viewportBounds]);

  // Reposition without changing visibility (driven by the ResizeObserver).
  const syncBounds = useCallback(() => {
    if (!api.isVisible) {
      return;
    }
    const bounds = viewportBounds();
    if (bounds === undefined) {
      return;
    }
    void setBrowserPanelBounds(params.panelId, bounds);
  }, [api, params.panelId, viewportBounds]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => showAtViewport());
    return () => {
      cancelAnimationFrame(frame);
      void hideBrowserPanel(params.panelId);
    };
  }, [params.panelId, showAtViewport]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    let frame: number | undefined;
    function scheduleSync() {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = undefined;
        syncBounds();
      });
    }
    const observer = new ResizeObserver(scheduleSync);
    observer.observe(viewport);
    window.addEventListener("resize", scheduleSync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleSync);
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, [syncBounds]);

  useEffect(() => {
    const disposable = api.onDidVisibilityChange((event) => {
      if (event.isVisible) {
        requestAnimationFrame(() => showAtViewport());
        return;
      }
      void hideBrowserPanel(params.panelId);
    });
    return () => disposable.dispose();
  }, [api, params.panelId, showAtViewport]);

  // Hide the native webview while any DOM overlay (portals, SettingsPage) is open above the
  // React tree — the webview floats above all DOM and would occlude context menus, dialogs,
  // dropdowns, and the settings page. Restore only when the panel is itself visible.
  const overlayActive = useBrowserOverlayActive();
  useEffect(() => {
    if (overlayActive) {
      void hideBrowserPanel(params.panelId);
      return;
    }
    if (api.isVisible) {
      requestAnimationFrame(() => showAtViewport());
    }
  }, [api.isVisible, overlayActive, params.panelId, showAtViewport]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    async function subscribe() {
      const fn = await listenToBrowserPanel(params.panelId, (event) => {
        if (event.kind === "navigated") {
          urlRef.current = event.url;
          setAddress(event.url);
          void updateBrowserPanelUrl({ panelId: params.panelId, url: event.url });
          return;
        }
        api.setTitle(event.title);
      });
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    }
    void subscribe();
    return () => {
      cancelled = true;
      if (unlisten !== undefined) {
        unlisten();
      }
    };
  }, [api, params.panelId]);

  function submitAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = address.trim();
    if (trimmed.length === 0) {
      return;
    }
    void navigateBrowserPanel(params.panelId, normalizeUrl(trimmed));
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-editor-surface">
      <form
        onSubmit={submitAddress}
        className="flex shrink-0 items-center gap-1 border-b border-border p-1.5"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Go back"
          onClick={() => void goBackBrowserPanel(params.panelId)}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Go forward"
          onClick={() => void goForwardBrowserPanel(params.panelId)}
        >
          <ArrowRight className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Reload"
          onClick={() => void reloadBrowserPanel(params.panelId)}
        >
          <RotateCw className="size-4" />
        </Button>
        <Input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className="h-8"
          placeholder="Enter a URL"
          spellCheck={false}
          aria-label="Address"
        />
      </form>
      <div ref={viewportRef} className="relative min-h-0 flex-1">
        {overlayActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-editor-surface/80 p-8 backdrop-blur-sm">
            <div className="flex w-full max-w-md flex-col gap-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="mt-2 h-24 w-full" />
            </div>
            <p className="text-sm text-muted-foreground">Browser content temporarily hidden</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Treat a bare host (no scheme) as https so the address bar accepts "example.com".
function normalizeUrl(value: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    return value;
  }
  return `https://${value}`;
}

export { BrowserPanel, type BrowserPanelParams };
