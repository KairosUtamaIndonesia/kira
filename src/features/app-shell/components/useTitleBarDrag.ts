import type { MouseEvent, PointerEvent } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";

const appWindow = getCurrentWindow();

function describeTitleBarError(error: unknown) {
  if (error instanceof Error) {
    return `Could not update the window: ${error.message}`;
  }

  return "Could not update the window.";
}

function isInteractiveTitleBarTarget(target: EventTarget) {
  return (
    target instanceof Element && target.closest("button, input, [data-window-controls]") !== null
  );
}

function useTitleBarDrag() {
  const [titleBarError, setTitleBarError] = useState<string>();

  async function handleTitleBarMouseDown(
    event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>,
  ) {
    if (event.buttons !== 1) {
      return;
    }

    if (event.detail > 1) {
      return;
    }

    if (isInteractiveTitleBarTarget(event.target)) {
      return;
    }

    setTitleBarError(undefined);

    try {
      await appWindow.startDragging();
    } catch (error: unknown) {
      setTitleBarError(describeTitleBarError(error));
    }
  }

  async function handleTitleBarDoubleClick(event: MouseEvent<HTMLElement>) {
    if (isInteractiveTitleBarTarget(event.target)) {
      return;
    }

    setTitleBarError(undefined);

    try {
      await appWindow.toggleMaximize();
    } catch (error: unknown) {
      setTitleBarError(describeTitleBarError(error));
    }
  }

  return { handleTitleBarDoubleClick, handleTitleBarMouseDown, titleBarError };
}

export { useTitleBarDrag };
