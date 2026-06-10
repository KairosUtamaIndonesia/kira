import { useSyncExternalStore } from "react";

// Tracks how many DOM overlays (portals, full-page surfaces like SettingsPage) are currently
// open above the React tree. The BrowserPanel subscribes and hides its native webview while
// any overlay is active — the webview floats above all DOM and would otherwise occlude
// context menus, dialogs, dropdowns, and the settings page.

let suppressionCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function suppressBrowserOverlays() {
  suppressionCount += 1;
  if (suppressionCount === 1) {
    emit();
  }
}

function releaseBrowserOverlays() {
  if (suppressionCount === 0) {
    return;
  }
  suppressionCount -= 1;
  if (suppressionCount === 0) {
    emit();
  }
}

function getBrowserOverlaysActive() {
  return suppressionCount > 0;
}

function subscribeBrowserOverlays(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useBrowserOverlayActive() {
  return useSyncExternalStore(subscribeBrowserOverlays, getBrowserOverlaysActive);
}

export { releaseBrowserOverlays, suppressBrowserOverlays, useBrowserOverlayActive };
