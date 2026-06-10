type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// Element context captured by the in-page selector overlay. Mirrors the JSON payload built by
// `browser_selector.rs::extract_payload` in the injected guest script.
type ElementCaptureRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ElementCaptureTarget = {
  tagName: string;
  selector: string;
  attributes: Record<string, string>;
  classes: string[];
  textContent: string;
  htmlSnippet: string;
  rect: ElementCaptureRect;
};

type ElementCapturePageContext = {
  url: string;
  title: string;
  selectedText: string;
};

type ElementCaptureAccessibility = {
  role: string;
  label: string;
  describedBy: string;
};

type ElementCapturePayload = {
  target: ElementCaptureTarget;
  pageContext: ElementCapturePageContext;
  accessibility: ElementCaptureAccessibility;
  computedStyles: Record<string, string>;
  ancestorPath: string[];
  nearbyText: string[];
};

// `capture` carries the raw JSON string the guest script encoded into the intercepted
// navigation; the frontend parses it into an `ElementCapturePayload`.
type BrowserPanelEvent =
  | { kind: "navigated"; url: string }
  | { kind: "titleChanged"; title: string }
  | { kind: "capture"; payload: string };

export type {
  BrowserBounds,
  BrowserPanelEvent,
  ElementCaptureAccessibility,
  ElementCapturePageContext,
  ElementCapturePayload,
  ElementCaptureRect,
  ElementCaptureTarget,
};
