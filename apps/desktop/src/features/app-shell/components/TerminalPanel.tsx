import type { IDockviewPanelProps } from "dockview-react";

import { Channel, invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Terminal as XtermTerminal, type ITheme } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";

type TerminalPanelParams = {
  terminalId: string;
  workingDirectory: string;
};

type TerminalOutputEvent = {
  event: "output";
  data: {
    id: string;
    data: string;
  };
};

type TerminalExitedEvent = {
  event: "exited";
  data: {
    id: string;
    code: number;
  };
};

type TerminalErrorEvent = {
  event: "error";
  data: {
    id: string;
    message: string;
  };
};

type TerminalEvent = TerminalOutputEvent | TerminalExitedEvent | TerminalErrorEvent;

type TerminalSize = {
  rows: number;
  cols: number;
};

type TerminalRuntime = {
  terminalId: string;
  terminal: XtermTerminal;
  fitAddon: FitAddon;
  subscriptionId: string;
  sessionId: string | undefined;
  spawnStarted: boolean;
  status: string | undefined;
  statusListeners: Set<(status: string | undefined) => void>;
};

const terminalRuntimes = new Map<string, TerminalRuntime>();

function TerminalPanel({ api, params }: IDockviewPanelProps<TerminalPanelParams>) {
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<TerminalRuntime | undefined>(void 0);
  const [status, setStatus] = useState<string | undefined>(void 0);

  const fitTerminal = useCallback(() => {
    if (!api.isVisible) {
      return;
    }

    const terminalHost = terminalHostRef.current;
    const runtime = runtimeRef.current;
    if (
      terminalHost === null ||
      runtime === undefined ||
      terminalHost.clientWidth === 0 ||
      terminalHost.clientHeight === 0
    ) {
      return;
    }

    runtime.fitAddon.fit();
  }, [api]);

  const resizeBackendTerminal = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime === undefined) {
      return;
    }

    void resizeTerminal(runtime, { cols: runtime.terminal.cols, rows: runtime.terminal.rows });
  }, []);

  useEffect(() => {
    const terminalHost = terminalHostRef.current;
    if (terminalHost === null) {
      return;
    }

    const runtime = getOrCreateTerminalRuntime(params.terminalId);
    runtimeRef.current = runtime;
    setStatus(runtime.status);
    runtime.statusListeners.add(setStatus);
    mountTerminalRuntime(runtime, terminalHost);

    requestAnimationFrame(() => {
      fitTerminal();
      void startTerminalSession(runtime, params.workingDirectory);
      runtime.terminal.focus();
    });

    return () => {
      runtime.statusListeners.delete(setStatus);
      runtimeRef.current = void 0;
    };
  }, [fitTerminal, params.terminalId, params.workingDirectory]);

  useEffect(() => {
    const disposable = api.onDidVisibilityChange((event) => {
      if (event.isVisible) {
        requestAnimationFrame(() => {
          fitTerminal();
          resizeBackendTerminal();
          const runtime = runtimeRef.current;
          if (runtime !== undefined) {
            runtime.terminal.focus();
          }
        });
      }
    });

    return () => disposable.dispose();
  }, [api, fitTerminal, resizeBackendTerminal]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-editor-surface text-foreground">
      {status === undefined ? undefined : (
        <div className="border-b border-border bg-muted px-3 py-2 text-muted-foreground">
          {status}
        </div>
      )}
      <div ref={terminalHostRef} className="kira-xterm h-full min-h-0 flex-1 overflow-hidden" />
    </section>
  );
}

function getOrCreateTerminalRuntime(terminalId: string) {
  const existingRuntime = terminalRuntimes.get(terminalId);
  if (existingRuntime !== undefined) {
    return existingRuntime;
  }

  const themeStyle = getComputedStyle(document.documentElement);
  const terminal = new XtermTerminal({
    convertEol: true,
    cursorBlink: true,
    fontFamily: requireCssVariable(themeStyle, "--font-mono"),
    fontSize: parseRootRemSize(themeStyle),
    lineHeight: 1.4,
    scrollback: 10_000,
    theme: xtermThemeFromStyle(themeStyle),
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const runtime: TerminalRuntime = {
    terminalId,
    terminal,
    fitAddon,
    subscriptionId: crypto.randomUUID(),
    sessionId: void 0,
    spawnStarted: false,
    status: void 0,
    statusListeners: new Set(),
  };

  terminal.onData((data) => {
    void writeTerminalInput(runtime, data);
  });
  terminal.onResize((size) => {
    void resizeTerminal(runtime, size);
  });

  terminalRuntimes.set(terminalId, runtime);
  return runtime;
}

function mountTerminalRuntime(runtime: TerminalRuntime, terminalHost: HTMLDivElement) {
  const terminalElement = runtime.terminal.element;
  if (terminalElement === undefined) {
    runtime.terminal.open(terminalHost);
    return;
  }

  terminalHost.appendChild(terminalElement);
}

async function startTerminalSession(runtime: TerminalRuntime, workingDirectory: string) {
  if (runtime.spawnStarted) {
    return;
  }

  runtime.spawnStarted = true;
  runtime.sessionId = runtime.terminalId;
  setRuntimeStatus(runtime, void 0);

  const channel = new Channel<TerminalEvent>((message) => {
    handleTerminalEvent(runtime, message);
  });
  const size = { cols: runtime.terminal.cols, rows: runtime.terminal.rows };

  try {
    await invoke("terminal_spawn", {
      input: {
        id: runtime.terminalId,
        subscriptionId: runtime.subscriptionId,
        size,
        options: {
          workingDirectory,
        },
      },
      onEvent: channel,
    });
    await resizeTerminal(runtime, { cols: runtime.terminal.cols, rows: runtime.terminal.rows });
  } catch (error) {
    if (!isDuplicateSessionError(error, runtime.terminalId)) {
      runtime.spawnStarted = false;
      runtime.sessionId = void 0;
      setRuntimeStatus(runtime, errorToMessage(error));
      return;
    }

    try {
      await invoke("terminal_attach", {
        id: runtime.terminalId,
        subscriptionId: runtime.subscriptionId,
        onEvent: channel,
      });
      setRuntimeStatus(runtime, void 0);
      await resizeTerminal(runtime, { cols: runtime.terminal.cols, rows: runtime.terminal.rows });
    } catch (attachError) {
      runtime.spawnStarted = false;
      runtime.sessionId = void 0;
      setRuntimeStatus(runtime, errorToMessage(attachError));
    }
  }
}

function handleTerminalEvent(runtime: TerminalRuntime, message: TerminalEvent) {
  if (message.data.id !== runtime.terminalId) {
    return;
  }

  switch (message.event) {
    case "output":
      runtime.terminal.write(message.data.data);
      break;
    case "exited":
      runtime.sessionId = void 0;
      runtime.spawnStarted = false;
      setRuntimeStatus(runtime, `Terminal exited with code ${message.data.code}.`);
      break;
    case "error":
      setRuntimeStatus(runtime, message.data.message);
      break;
  }
}

function setRuntimeStatus(runtime: TerminalRuntime, status: string | undefined) {
  runtime.status = status;
  for (const listener of runtime.statusListeners) {
    listener(status);
  }
}

function xtermThemeFromStyle(style: CSSStyleDeclaration): ITheme {
  return {
    background: requireCssVariable(style, "--editor-surface"),
    foreground: requireCssVariable(style, "--foreground"),
    cursor: requireCssVariable(style, "--ring"),
    selectionBackground: requireCssVariable(style, "--ring"),
    black: requireCssVariable(style, "--terminal-ansi-black"),
    red: requireCssVariable(style, "--terminal-ansi-red"),
    green: requireCssVariable(style, "--terminal-ansi-green"),
    yellow: requireCssVariable(style, "--terminal-ansi-yellow"),
    blue: requireCssVariable(style, "--terminal-ansi-blue"),
    magenta: requireCssVariable(style, "--terminal-ansi-magenta"),
    cyan: requireCssVariable(style, "--terminal-ansi-cyan"),
    white: requireCssVariable(style, "--terminal-ansi-white"),
    brightBlack: requireCssVariable(style, "--terminal-ansi-bright-black"),
    brightRed: requireCssVariable(style, "--terminal-ansi-bright-red"),
    brightGreen: requireCssVariable(style, "--terminal-ansi-bright-green"),
    brightYellow: requireCssVariable(style, "--terminal-ansi-bright-yellow"),
    brightBlue: requireCssVariable(style, "--terminal-ansi-bright-blue"),
    brightMagenta: requireCssVariable(style, "--terminal-ansi-bright-magenta"),
    brightCyan: requireCssVariable(style, "--terminal-ansi-bright-cyan"),
    brightWhite: requireCssVariable(style, "--terminal-ansi-bright-white"),
  };
}

function parseRootRemSize(style: CSSStyleDeclaration) {
  const fontSize = Number.parseFloat(style.fontSize);
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    throw new Error(`Root font size is invalid: ${style.fontSize}`);
  }

  return fontSize;
}

function requireCssVariable(style: CSSStyleDeclaration, variableName: string) {
  const value = style.getPropertyValue(variableName).trim();
  if (value.length === 0) {
    throw new Error(`Terminal CSS variable is required: ${variableName}`);
  }

  return value;
}

async function writeTerminalInput(runtime: TerminalRuntime, data: string) {
  if (runtime.sessionId === undefined) {
    return;
  }

  try {
    await invoke("terminal_write", {
      id: runtime.sessionId,
      data,
    });
  } catch (error) {
    setRuntimeStatus(runtime, errorToMessage(error));
  }
}

async function resizeTerminal(runtime: TerminalRuntime, size: TerminalSize) {
  if (runtime.sessionId === undefined) {
    return;
  }

  try {
    await invoke("terminal_resize", {
      id: runtime.sessionId,
      size,
    });
  } catch (error) {
    setRuntimeStatus(runtime, errorToMessage(error));
  }
}

function isDuplicateSessionError(error: unknown, sessionId: string) {
  return errorToMessage(error) === `terminal session already exists: ${sessionId}`;
}

function errorToMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Terminal operation failed with an unknown error.";
}

export { TerminalPanel, type TerminalPanelParams };
