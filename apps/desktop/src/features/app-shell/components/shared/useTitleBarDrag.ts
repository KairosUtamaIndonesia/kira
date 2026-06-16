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

// React portals re-dispatch events through the React tree, so a press inside
// portalled UI owned by the title bar (dropdown menus, dialogs) still reaches
// these handlers even though the target is not a DOM descendant. Such a press
// must never start a window drag: startDragging() hands the gesture to the OS,
// which swallows the mouseup and the portalled control never gets its click.
function isTitleBarSurfaceTarget(titleBar: HTMLElement, target: EventTarget) {
  return (
    target instanceof Element &&
    titleBar.contains(target) &&
    target.closest("button, input, [data-window-controls]") === null
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

    if (!isTitleBarSurfaceTarget(event.currentTarget, event.target)) {
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
    if (!isTitleBarSurfaceTarget(event.currentTarget, event.target)) {
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
