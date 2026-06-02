import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useState } from "react";

const appWindow = getCurrentWindow();

type WindowControlAction = "minimize" | "toggle maximize" | "close";

function describeWindowControlError(action: WindowControlAction, error: unknown) {
  if (error instanceof Error) {
    return `Could not ${action} the window: ${error.message}`;
  }

  return `Could not ${action} the window.`;
}

function AppWindowControls() {
  const [windowControlError, setWindowControlError] = useState<string>();

  async function runWindowControl(
    action: WindowControlAction,
    command: () => Promise<void>,
  ) {
    setWindowControlError(undefined);

    try {
      await command();
    } catch (error: unknown) {
      setWindowControlError(describeWindowControlError(action, error));
    }
  }

  return (
    <div
      data-window-controls
      className="flex items-center"
      aria-label="Window controls"
    >
      <button
        type="button"
        className="flex size-9 items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label="Minimize window"
        onClick={() => {
          runWindowControl("minimize", () => appWindow.minimize());
        }}
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="flex size-9 items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label="Maximize or restore window"
        onClick={() => {
          runWindowControl("toggle maximize", () => appWindow.toggleMaximize());
        }}
      >
        <Square className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="flex size-9 items-center justify-center text-muted-foreground hover:bg-destructive hover:text-white focus-visible:ring-2 focus-visible:ring-destructive focus-visible:outline-none"
        aria-label="Close window"
        onClick={() => {
          runWindowControl("close", () => appWindow.close());
        }}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      {windowControlError === undefined ? undefined : (
        <output className="sr-only">{windowControlError}</output>
      )}
    </div>
  );
}

export { AppWindowControls };
