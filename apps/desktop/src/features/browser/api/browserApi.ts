import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { BrowserBounds, BrowserPanelEvent } from "../types";

function openBrowserPanel(panelId: string, url: string, bounds: BrowserBounds) {
  return invoke<void>("browser_panel_open", { panelId, url, bounds });
}

function setBrowserPanelBounds(panelId: string, bounds: BrowserBounds) {
  return invoke<void>("browser_panel_set_bounds", { panelId, bounds });
}

function hideBrowserPanel(panelId: string) {
  return invoke<void>("browser_panel_hide", { panelId });
}

function navigateBrowserPanel(panelId: string, url: string) {
  return invoke<void>("browser_panel_navigate", { panelId, url });
}

function reloadBrowserPanel(panelId: string) {
  return invoke<void>("browser_panel_reload", { panelId });
}

function goBackBrowserPanel(panelId: string) {
  return invoke<void>("browser_panel_go_back", { panelId });
}

function goForwardBrowserPanel(panelId: string) {
  return invoke<void>("browser_panel_go_forward", { panelId });
}

function closeBrowserPanel(panelId: string) {
  return invoke<void>("browser_panel_close", { panelId });
}

function closeOrphanBrowserPanels(keepPanelIds: string[]) {
  return invoke<void>("browser_close_orphans", { keepPanelIds });
}

function listenToBrowserPanel(
  panelId: string,
  handler: (event: BrowserPanelEvent) => void,
): Promise<UnlistenFn> {
  return listen<BrowserPanelEvent>(`browser://${panelId}`, (event) => handler(event.payload));
}

export {
  closeBrowserPanel,
  closeOrphanBrowserPanels,
  goBackBrowserPanel,
  goForwardBrowserPanel,
  hideBrowserPanel,
  listenToBrowserPanel,
  navigateBrowserPanel,
  openBrowserPanel,
  reloadBrowserPanel,
  setBrowserPanelBounds,
};
