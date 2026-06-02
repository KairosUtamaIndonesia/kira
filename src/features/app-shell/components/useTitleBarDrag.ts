import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent, PointerEvent } from "react";
import { useState } from "react";

const appWindow = getCurrentWindow();

function describeTitleBarError(error: unknown) {
  if (error instanceof Error) {
    return `Could not move the window: ${error.message}`;
  }

  return "Could not move the window.";
}

function useTitleBarDrag() {
  const [titleBarError, setTitleBarError] = useState<string>();

  async function handleTitleBarMouseDown(event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>) {
    if (event.buttons !== 1) {
      return;
    }

    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest("button, input, [data-window-controls]")) {
      return;
    }

    setTitleBarError(undefined);

    try {
      if (event.detail === 2) {
        await appWindow.toggleMaximize();
        return;
      }

      await appWindow.startDragging();
    } catch (error: unknown) {
      setTitleBarError(describeTitleBarError(error));
    }
  }

  return { handleTitleBarMouseDown, titleBarError };
}

export { useTitleBarDrag };
