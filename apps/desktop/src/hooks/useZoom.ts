import { useEffect, useRef } from "react";

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;
const DEFAULT_ZOOM = 1.0;

function useZoom() {
  const zoomRef = useRef(DEFAULT_ZOOM);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement)
      ) {
        return;
      }

      let newZoom: number | undefined;

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        newZoom = Math.min(MAX_ZOOM, zoomRef.current + ZOOM_STEP);
      } else if (event.key === "-") {
        event.preventDefault();
        newZoom = Math.max(MIN_ZOOM, zoomRef.current - ZOOM_STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        newZoom = DEFAULT_ZOOM;
      }

      if (newZoom !== undefined && newZoom !== zoomRef.current) {
        zoomRef.current = newZoom;
        void getCurrentWebviewWindow().setZoom(newZoom);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

export { useZoom };
