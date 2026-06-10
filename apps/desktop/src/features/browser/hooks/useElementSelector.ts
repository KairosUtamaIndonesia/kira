import type { UnlistenFn } from "@tauri-apps/api/event";

import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "@/components/ui/sonner";

import type { ElementCapturePayload } from "../types";

import { listenToBrowserPanel, setBrowserPanelSelectorMode } from "../api/browserApi";

// Drives the in-page element selector for a single Browser Panel. The selector is a native
// overlay injected into the child webview; arming `eval`s the guest script, the user clicks an
// element, and the guest script reports the capture back over the panel's event channel as a
// `capture` event (navigation-interception bridge). Capture is one-shot: receiving one disarms
// the native overlay and surfaces the parsed payload for the capture sheet.
type ElementSelectorState =
  | { status: "idle" }
  | { status: "armed" }
  | { status: "captured"; payload: ElementCapturePayload };

function useElementSelector(panelId: string) {
  const [state, setState] = useState<ElementSelectorState>({ status: "idle" });
  const stateRef = useRef(state);
  stateRef.current = state;

  const disarm = useCallback(() => {
    setState({ status: "idle" });
    void setBrowserPanelSelectorMode(panelId, false);
  }, [panelId]);

  const arm = useCallback(() => {
    setState({ status: "armed" });
    void setBrowserPanelSelectorMode(panelId, true);
  }, [panelId]);

  const dismissCapture = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    async function subscribe() {
      const fn = await listenToBrowserPanel(panelId, (event) => {
        if (event.kind !== "capture") {
          return;
        }
        const payload = parseCapturePayload(event.payload);
        if (payload === undefined) {
          toast.error("Could not read the captured element.");
          void setBrowserPanelSelectorMode(panelId, false);
          setState({ status: "idle" });
          return;
        }
        // Capture is one-shot: the native overlay is spent, so tear it down.
        void setBrowserPanelSelectorMode(panelId, false);
        setState({ status: "captured", payload });
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
      if (stateRef.current.status === "armed") {
        void setBrowserPanelSelectorMode(panelId, false);
      }
    };
  }, [panelId]);

  return { state, arm, disarm, dismissCapture };
}

function parseCapturePayload(raw: string): ElementCapturePayload | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isElementCapturePayload(parsed)) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function isElementCapturePayload(value: unknown): value is ElementCapturePayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const target = candidate.target;
  if (typeof target !== "object" || target === null) {
    return false;
  }
  return typeof (target as Record<string, unknown>).tagName === "string";
}

export { useElementSelector, type ElementSelectorState };
