type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type BrowserPanelEvent =
  | { kind: "navigated"; url: string }
  | { kind: "titleChanged"; title: string };

export type { BrowserBounds, BrowserPanelEvent };
