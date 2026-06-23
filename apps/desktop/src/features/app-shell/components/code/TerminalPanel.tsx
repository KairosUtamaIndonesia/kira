import type { IDockviewPanelProps } from "dockview-react";

import { Channel, invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XtermTerminal, type ITheme } from "@xterm/xterm";
import { XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { TerminalSnapshot } from "@/features/projects/types";

import { Button } from "@/components/ui/button";
import { getTerminalSnapshot, saveTerminalSnapshot } from "@/features/projects/api/projectsApi";

type TerminalPanelParams = {
  terminalId: string;
  workingDirectory: string;
};

type TerminalOutputEvent = {
  event: "output";
  data: {
    id: string;
    sequence: number;
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
  serializeAddon: SerializeAddon;
  subscriptionId: string;
  sessionId: string | undefined;
  spawnStarted: boolean;
  status: string | undefined;
  statusListeners: Set<(status: string | undefined) => void>;
  eventChannel: Channel<TerminalEvent> | undefined;
  startupPromise: Promise<void> | undefined;
  snapshotRestorePromise: Promise<void> | undefined;
  lastAppliedSequence: number;
  restoredFromSnapshot: boolean;
  snapshotTimer: number | undefined;
  snapshotInFlight: boolean;
  snapshotQueued: boolean;
};

const terminalRuntimes = new Map<string, TerminalRuntime>();
const TERMINAL_SNAPSHOT_DEBOUNCE_MS = 500;
const TERMINAL_REPLAY_UNAVAILABLE_FRAGMENT = "cannot replay output after sequence";
const TERMINAL_REPLAY_INCOMPLETE_STATUS =
  "Terminal reconnected, but some display history could not be restored.";
const TERMINAL_SESSION_RESTARTED_STATUS =
  "Terminal display restored. Terminal session was restarted.";
const TERMINAL_RESTART_SEPARATOR = "\x1b[0m\r\n";

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

  const dismissStatus = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime === undefined) {
      return;
    }

    setRuntimeStatus(runtime, void 0);
  }, []);

  const focusTerminal = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime === undefined) {
      return;
    }

    runtime.terminal.focus();
  }, []);

  useEffect(() => {
    let disposed = false;
    let initializedRuntime: TerminalRuntime | undefined = void 0;

    async function initializeTerminalPanel() {
      const terminalHost = terminalHostRef.current;
      if (terminalHost === null) {
        return;
      }

      const runtime = await getOrCreateTerminalRuntime(params.terminalId);
      if (disposed) {
        void flushTerminalSnapshot(runtime);
        return;
      }

      initializedRuntime = runtime;
      runtimeRef.current = runtime;
      setStatus(runtime.status);
      runtime.statusListeners.add(setStatus);
      applyTerminalStyle(runtime);
      mountTerminalRuntime(runtime, terminalHost);

      requestAnimationFrame(() => {
        void initializeMountedTerminalRuntime(runtime);
      });
    }

    async function initializeMountedTerminalRuntime(runtime: TerminalRuntime) {
      fitTerminal();
      await ensureTerminalRuntimeStarted(runtime, params.workingDirectory);
      if (disposed) {
        void flushTerminalSnapshot(runtime);
        return;
      }

      runtime.terminal.focus();
    }

    void initializeTerminalPanel();

    return () => {
      disposed = true;
      if (initializedRuntime !== undefined) {
        initializedRuntime.statusListeners.delete(setStatus);
        void flushTerminalSnapshot(initializedRuntime);
      }
      runtimeRef.current = void 0;
    };
  }, [fitTerminal, params.terminalId, params.workingDirectory]);

  useEffect(() => {
    requestAnimationFrame(() => {
      fitTerminal();
      resizeBackendTerminal();
      const runtime = runtimeRef.current;
      if (runtime !== undefined) {
        runtime.terminal.scrollToBottom();
      }
    });
  }, [fitTerminal, resizeBackendTerminal, status]);

  useEffect(() => {
    let animationFrame: number | undefined = void 0;

    function refitVisibleTerminal() {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = void 0;
        fitTerminal();
        resizeBackendTerminal();
      });
    }

    const terminalHost = terminalHostRef.current;
    if (terminalHost === null) {
      return () => {
        if (animationFrame !== undefined) {
          window.cancelAnimationFrame(animationFrame);
        }
      };
    }

    const observer = new ResizeObserver(() => refitVisibleTerminal());
    observer.observe(terminalHost);

    return () => {
      observer.disconnect();
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [fitTerminal, resizeBackendTerminal]);

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
        return;
      }

      const runtime = runtimeRef.current;
      if (runtime !== undefined) {
        void flushTerminalSnapshot(runtime);
      }
    });

    return () => disposable.dispose();
  }, [api, fitTerminal, resizeBackendTerminal]);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          applyTerminalStyles();
          return;
        }
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function flushVisibleTerminalSnapshot() {
      const runtime = runtimeRef.current;
      if (runtime !== undefined) {
        void flushTerminalSnapshot(runtime);
      }
    }

    function flushWhenDocumentIsHidden() {
      if (document.visibilityState === "hidden") {
        flushVisibleTerminalSnapshot();
      }
    }

    document.addEventListener("visibilitychange", flushWhenDocumentIsHidden);
    window.addEventListener("beforeunload", flushVisibleTerminalSnapshot);

    return () => {
      document.removeEventListener("visibilitychange", flushWhenDocumentIsHidden);
      window.removeEventListener("beforeunload", flushVisibleTerminalSnapshot);
    };
  }, []);

  return (
    <section className="flex h-full min-h-0 flex-col bg-editor-surface text-foreground">
      {status === undefined ? undefined : (
        <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2 text-muted-foreground">
          <span className="min-w-0 flex-1">{status}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss terminal status"
            onClick={dismissStatus}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      )}
      <div
        className="kira-xterm h-full min-h-0 flex-1 overflow-hidden p-2"
        onPointerDown={focusTerminal}
      >
        <div ref={terminalHostRef} className="h-full min-h-0" />
      </div>
    </section>
  );
}

async function getOrCreateTerminalRuntime(terminalId: string) {
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
  const serializeAddon = new SerializeAddon();
  terminal.loadAddon(fitAddon);
  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      /* WebglAddon auto-disposes on context loss; canvas renderer takes over */
    });
    terminal.loadAddon(webglAddon);
  } catch {
    /* WebGL not available, falling back to canvas renderer */
  }
  terminal.loadAddon(serializeAddon);

  const runtime: TerminalRuntime = {
    terminalId,
    terminal,
    fitAddon,
    serializeAddon,
    subscriptionId: crypto.randomUUID(),
    sessionId: void 0,
    spawnStarted: false,
    status: void 0,
    statusListeners: new Set(),
    eventChannel: void 0,
    startupPromise: void 0,
    snapshotRestorePromise: void 0,
    lastAppliedSequence: 0,
    restoredFromSnapshot: false,
    snapshotTimer: void 0,
    snapshotInFlight: false,
    snapshotQueued: false,
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

async function ensureTerminalRuntimeStarted(runtime: TerminalRuntime, workingDirectory: string) {
  if (runtime.startupPromise !== undefined) {
    await runtime.startupPromise;
    return;
  }

  const startupPromise = initializeTerminalRuntimeSession(runtime, workingDirectory);
  runtime.startupPromise = startupPromise;

  try {
    await startupPromise;
  } finally {
    runtime.startupPromise = void 0;
  }
}

async function initializeTerminalRuntimeSession(
  runtime: TerminalRuntime,
  workingDirectory: string,
) {
  await startTerminalSession(runtime, workingDirectory);
}

async function restoreTerminalSnapshot(runtime: TerminalRuntime) {
  if (runtime.snapshotRestorePromise !== undefined) {
    await runtime.snapshotRestorePromise;
    return;
  }

  const restorePromise = loadTerminalSnapshot(runtime);
  runtime.snapshotRestorePromise = restorePromise;
  await restorePromise;
}

async function loadTerminalSnapshot(runtime: TerminalRuntime) {
  try {
    const snapshot = await getTerminalSnapshot({ terminalId: runtime.terminalId });
    if (snapshot === null) {
      return;
    }

    validateTerminalSnapshot(runtime.terminalId, snapshot);
    const displayHistory = await createRestorableTerminalDisplayHistory(snapshot);
    runtime.terminal.reset();
    runtime.terminal.resize(snapshot.cols, snapshot.rows);
    await writeTerminalOutput(runtime.terminal, displayHistory);
    await writeTerminalOutput(runtime.terminal, TERMINAL_RESTART_SEPARATOR);
    runtime.fitAddon.fit();
    runtime.terminal.scrollToBottom();
    runtime.lastAppliedSequence = snapshot.sequence;
    runtime.restoredFromSnapshot = true;
  } catch (error) {
    setRuntimeStatus(runtime, errorToMessage(error));
  }
}

function validateTerminalSnapshot(terminalId: string, snapshot: TerminalSnapshot) {
  if (snapshot.terminalId !== terminalId) {
    throw new Error(
      `Terminal snapshot id mismatch: expected ${terminalId}, got ${snapshot.terminalId}`,
    );
  }

  if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0) {
    throw new Error(`Terminal snapshot sequence is invalid: ${snapshot.sequence}`);
  }

  if (!Number.isSafeInteger(snapshot.cols) || snapshot.cols <= 0) {
    throw new Error(`Terminal snapshot column count is invalid: ${snapshot.cols}`);
  }

  if (!Number.isSafeInteger(snapshot.rows) || snapshot.rows <= 0) {
    throw new Error(`Terminal snapshot row count is invalid: ${snapshot.rows}`);
  }

  if (snapshot.serialized.length === 0) {
    throw new Error("Terminal snapshot payload is empty.");
  }
}

async function createRestorableTerminalDisplayHistory(snapshot: TerminalSnapshot) {
  const terminal = new XtermTerminal({
    cols: snapshot.cols,
    rows: snapshot.rows,
    convertEol: true,
    scrollback: 10_000,
  });
  const serializeAddon = new SerializeAddon();
  terminal.loadAddon(serializeAddon);

  try {
    await writeTerminalOutput(terminal, snapshot.serialized);
    const displayHistory = serializeTerminalDisplayHistory(terminal, serializeAddon);
    if (displayHistory.length === 0) {
      throw new Error(`Terminal snapshot ${snapshot.terminalId} produced empty display history.`);
    }

    return displayHistory;
  } finally {
    terminal.dispose();
  }
}

function serializeTerminalDisplayHistory(terminal: XtermTerminal, serializeAddon: SerializeAddon) {
  const normalBuffer = terminal.buffer.normal;
  return serializeAddon.serialize({
    range: {
      start: 0,
      end: normalBuffer.length - 1,
    },
    excludeAltBuffer: true,
    excludeModes: true,
  });
}

function writeTerminalOutput(terminal: XtermTerminal, data: string) {
  return new Promise<void>((resolve) => {
    terminal.write(data, resolve);
  });
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
  runtime.sessionId = void 0;
  setRuntimeStatus(runtime, void 0);

  await restoreTerminalSnapshot(runtime);

  const channel = new Channel<TerminalEvent>((message) => {
    handleTerminalEvent(runtime, message);
  });
  runtime.eventChannel = channel;
  const size = { cols: runtime.terminal.cols, rows: runtime.terminal.rows };

  try {
    await invoke("terminal_spawn", {
      input: {
        id: runtime.terminalId,
        subscriptionId: runtime.subscriptionId,
        afterSequence: runtime.lastAppliedSequence,
        size,
        options: {
          workingDirectory,
        },
      },
      onEvent: channel,
    });
    runtime.sessionId = runtime.terminalId;
    if (runtime.restoredFromSnapshot) {
      setRuntimeStatus(runtime, TERMINAL_SESSION_RESTARTED_STATUS);
    }
    await resizeTerminal(runtime, { cols: runtime.terminal.cols, rows: runtime.terminal.rows });
  } catch (error) {
    if (!isDuplicateSessionError(error, runtime.terminalId)) {
      runtime.spawnStarted = false;
      runtime.sessionId = void 0;
      runtime.eventChannel = void 0;
      setRuntimeStatus(runtime, errorToMessage(error));
      return;
    }

    await attachTerminalSession(runtime, channel, runtime.lastAppliedSequence);
  }
}

async function attachTerminalSession(
  runtime: TerminalRuntime,
  channel: Channel<TerminalEvent>,
  afterSequence: number,
) {
  try {
    await invoke("terminal_attach", {
      input: {
        id: runtime.terminalId,
        subscriptionId: runtime.subscriptionId,
        afterSequence,
      },
      onEvent: channel,
    });
    runtime.sessionId = runtime.terminalId;
    setRuntimeStatus(runtime, void 0);
    await resizeTerminal(runtime, { cols: runtime.terminal.cols, rows: runtime.terminal.rows });
  } catch (attachError) {
    if (isReplayUnavailableError(attachError)) {
      runtime.terminal.reset();
      runtime.terminal.clear();
      runtime.lastAppliedSequence = 0;
      runtime.restoredFromSnapshot = false;
      setRuntimeStatus(runtime, TERMINAL_REPLAY_INCOMPLETE_STATUS);
      await attachTerminalSessionFromRetainedReplay(runtime, channel);
      return;
    }

    runtime.spawnStarted = false;
    runtime.sessionId = void 0;
    runtime.eventChannel = void 0;
    setRuntimeStatus(runtime, errorToMessage(attachError));
  }
}

async function attachTerminalSessionFromRetainedReplay(
  runtime: TerminalRuntime,
  channel: Channel<TerminalEvent>,
) {
  try {
    await invoke("terminal_attach", {
      input: {
        id: runtime.terminalId,
        subscriptionId: runtime.subscriptionId,
        afterSequence: 0,
      },
      onEvent: channel,
    });
    runtime.sessionId = runtime.terminalId;
    await resizeTerminal(runtime, { cols: runtime.terminal.cols, rows: runtime.terminal.rows });
  } catch (error) {
    runtime.spawnStarted = false;
    runtime.sessionId = void 0;
    runtime.eventChannel = void 0;
    setRuntimeStatus(runtime, errorToMessage(error));
  }
}

function handleTerminalEvent(runtime: TerminalRuntime, message: TerminalEvent) {
  if (message.data.id !== runtime.terminalId) {
    return;
  }

  switch (message.event) {
    case "output":
      runtime.terminal.write(message.data.data, () => {
        runtime.lastAppliedSequence = message.data.sequence;
        scheduleTerminalSnapshot(runtime);
      });
      break;
    case "exited":
      runtime.sessionId = void 0;
      runtime.spawnStarted = false;
      runtime.eventChannel = void 0;
      setRuntimeStatus(runtime, `Terminal exited with code ${message.data.code}.`);
      void flushTerminalSnapshot(runtime);
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

function scheduleTerminalSnapshot(runtime: TerminalRuntime) {
  if (runtime.snapshotTimer !== undefined) {
    window.clearTimeout(runtime.snapshotTimer);
  }

  runtime.snapshotTimer = window.setTimeout(() => {
    runtime.snapshotTimer = void 0;
    void flushTerminalSnapshot(runtime);
  }, TERMINAL_SNAPSHOT_DEBOUNCE_MS);
}

async function flushTerminalSnapshot(runtime: TerminalRuntime) {
  if (runtime.snapshotTimer !== undefined) {
    window.clearTimeout(runtime.snapshotTimer);
    runtime.snapshotTimer = void 0;
  }

  if (runtime.snapshotInFlight) {
    runtime.snapshotQueued = true;
    return;
  }

  const serialized = serializeTerminalDisplayHistory(runtime.terminal, runtime.serializeAddon);
  if (serialized.length === 0 || runtime.lastAppliedSequence < 0) {
    return;
  }

  runtime.snapshotInFlight = true;
  runtime.snapshotQueued = false;
  try {
    await saveTerminalSnapshot({
      terminalId: runtime.terminalId,
      sequence: runtime.lastAppliedSequence,
      serialized,
      cols: runtime.terminal.cols,
      rows: runtime.terminal.rows,
      capturedAt: new Date().toISOString(),
    });
  } catch (error) {
    setRuntimeStatus(runtime, errorToMessage(error));
  } finally {
    runtime.snapshotInFlight = false;
  }

  if (runtime.snapshotQueued) {
    runtime.snapshotQueued = false;
    await flushTerminalSnapshot(runtime);
  }
}

function applyTerminalStyles() {
  for (const runtime of terminalRuntimes.values()) {
    applyTerminalStyle(runtime);
  }
}

function applyTerminalStyle(runtime: TerminalRuntime) {
  const themeStyle = getComputedStyle(document.documentElement);
  runtime.terminal.options.theme = xtermThemeFromStyle(themeStyle);
  runtime.terminal.options.fontFamily = requireCssVariable(themeStyle, "--font-mono");
  runtime.terminal.options.fontSize = parseRootRemSize(themeStyle);
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
    setRuntimeStatus(runtime, "Terminal session is not connected yet.");
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

function isReplayUnavailableError(error: unknown) {
  return errorToMessage(error).includes(TERMINAL_REPLAY_UNAVAILABLE_FRAGMENT);
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
