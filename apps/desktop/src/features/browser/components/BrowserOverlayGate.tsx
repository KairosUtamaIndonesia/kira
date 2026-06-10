import { useEffect } from "react";

import { releaseBrowserOverlays, suppressBrowserOverlays } from "../browserOverlayStore";

// CSS selector covering every DOM surface that must float above the native browser webview.
// Base UI portals (Dialog, DropdownMenu, ContextMenu, Sheet, AlertDialog, HoverCard, Tooltip,
// Popover, Select) all carry a `data-slot` ending in "-portal"; the SettingsPage is a non-portal
// `<dialog>`; and Sonner stamps each live toast with `data-sonner-toast` (its always-mounted
// container is `data-sonner-toaster`, deliberately not matched so an empty toaster never hides
// the webview). The native webview renders above all DOM, so it is hidden while any of these are
// present and restored once they leave.
const OVERLAY_SELECTOR =
  '[data-slot$="-portal"], dialog.kira-settings-surface, [data-sonner-toast]';

// Mounted once at the AppShell root. Watches body for overlay additions/removals and drives
// the browser overlay store. The BrowserPanel subscribes and hides its native webview while
// any overlay is present, so the overlay renders unobstructed above the DOM.
function BrowserOverlayGate() {
  useEffect(() => {
    const tracked = new WeakSet<Node>();
    let suppressedCount = 0;

    const observer = new MutationObserver((mutations) => {
      let suppressedDelta = 0;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) {
            continue;
          }
          for (const match of collectOverlayMatches(node)) {
            if (tracked.has(match)) {
              continue;
            }
            tracked.add(match);
            suppressedDelta += 1;
          }
        }
        for (const node of mutation.removedNodes) {
          if (!(node instanceof Element)) {
            continue;
          }
          for (const match of collectOverlayMatches(node)) {
            if (!tracked.has(match)) {
              continue;
            }
            tracked.delete(match);
            suppressedDelta -= 1;
          }
        }
      }

      if (suppressedDelta === 0) {
        return;
      }

      if (suppressedDelta > 0) {
        for (let i = 0; i < suppressedDelta; i += 1) {
          suppressBrowserOverlays();
        }
      } else {
        for (let i = 0; i < -suppressedDelta; i += 1) {
          releaseBrowserOverlays();
        }
      }
      suppressedCount += suppressedDelta;
    });

    // Seed: cover any overlay already present (e.g. on hot reload or after an HMR remount).
    for (const match of document.body.querySelectorAll(OVERLAY_SELECTOR)) {
      if (tracked.has(match)) {
        continue;
      }
      tracked.add(match);
      suppressBrowserOverlays();
      suppressedCount += 1;
    }

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      for (let i = 0; i < suppressedCount; i += 1) {
        releaseBrowserOverlays();
      }
    };
  }, []);

  return <></>;
}

function collectOverlayMatches(root: Element): Element[] {
  if (root.matches(OVERLAY_SELECTOR)) {
    return [root];
  }
  return Array.from(root.querySelectorAll(OVERLAY_SELECTOR));
}

export { BrowserOverlayGate };
