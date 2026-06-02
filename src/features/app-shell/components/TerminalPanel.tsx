import type { IDockviewPanelProps } from "dockview-react";

import { Channel, invoke } from "@tauri-apps/api/core";
import "@wterm/react/css";
import { Terminal, useTerminal, type WTerm } from "@wterm/react";
import { useCallback, useEffect, useRef, useState } from "react";

type TerminalPanelParams = {
  terminalId: string;
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

function TerminalPanel({ params }: IDockviewPanelProps<TerminalPanelParams>) {
  const { ref, write, focus } = useTerminal();
  const sessionIdRef = useRef<string | undefined>(void 0);
  const spawnStartedRef = useRef(false);
  const latestSizeRef = useRef<TerminalSize>({ cols: 80, rows: 24 });
  const [status, setStatus] = useState<string | undefined>(void 0);

  const handleTerminalEvent = useCallback(
    (message: TerminalEvent) => {
      if (message.data.id !== params.terminalId) {
        return;
      }

      switch (message.event) {
        case "output":
          write(message.data.data);
          break;
        case "exited":
          sessionIdRef.current = void 0;
          spawnStartedRef.current = false;
          setStatus(`Terminal exited with code ${message.data.code}.`);
          break;
        case "error":
          setStatus(message.data.message);
          break;
      }
    },
    [params.terminalId, write],
  );

  const spawnTerminal = useCallback(
    async (size: TerminalSize) => {
      if (spawnStartedRef.current) {
        return;
      }

      spawnStartedRef.current = true;
      setStatus(void 0);
      const channel = new Channel<TerminalEvent>(handleTerminalEvent);

      try {
        await invoke("terminal_spawn", {
          id: params.terminalId,
          size,
          onEvent: channel,
        });
        sessionIdRef.current = params.terminalId;
        await resizeTerminal(params.terminalId, latestSizeRef.current, setStatus);
        focus();
      } catch (error) {
        spawnStartedRef.current = false;
        setStatus(errorToMessage(error));
      }
    },
    [focus, handleTerminalEvent, params.terminalId],
  );

  const handleReady = useCallback(
    (terminal: WTerm) => {
      patchTerminalScrollToBottom(terminal);
      const size = { cols: terminal.cols, rows: terminal.rows };
      latestSizeRef.current = size;
      void spawnTerminal(size);
    },
    [spawnTerminal],
  );

  const handleData = useCallback((data: string) => {
    void writeTerminalInput(sessionIdRef.current, data, setStatus);
  }, []);

  const handleResize = useCallback((cols: number, rows: number) => {
    const size = { cols, rows };
    latestSizeRef.current = size;
    void resizeTerminal(sessionIdRef.current, size, setStatus);
  }, []);

  useEffect(() => {
    return () => {
      const sessionId = sessionIdRef.current;
      if (sessionId === undefined) {
        return;
      }

      sessionIdRef.current = void 0;
      spawnStartedRef.current = false;
      void killTerminal(sessionId);
    };
  }, []);

  return (
    <section className="flex h-full min-h-0 flex-col bg-editor-surface text-foreground">
      {status === undefined ? undefined : (
        <div className="border-b border-border bg-muted px-3 py-2 text-muted-foreground">
          {status}
        </div>
      )}
      <Terminal
        ref={ref}
        className="h-full min-h-0 flex-1 scrollbar-editor font-mono"
        cols={80}
        rows={24}
        autoResize
        cursorBlink
        theme="kira"
        onData={handleData}
        onError={(error) => {
          setStatus(errorToMessage(error));
        }}
        onReady={handleReady}
        onResize={handleResize}
      />
    </section>
  );
}

function patchTerminalScrollToBottom(terminal: WTerm) {
  Object.defineProperty(terminal, "_scrollToBottom", {
    configurable: true,
    value: () => {
      scrollElementToBottom(terminal.element);
    },
  });
}

function scrollElementToBottom(element: HTMLElement) {
  const maxScrollTop = element.scrollHeight - element.clientHeight;
  element.scrollTop = Math.max(0, maxScrollTop);
}

async function writeTerminalInput(
  sessionId: string | undefined,
  data: string,
  setStatus: (status: string) => void,
) {
  if (sessionId === undefined) {
    return;
  }

  try {
    await invoke("terminal_write", {
      id: sessionId,
      data,
    });
  } catch (error) {
    setStatus(errorToMessage(error));
  }
}

async function resizeTerminal(
  sessionId: string | undefined,
  size: TerminalSize,
  setStatus: (status: string) => void,
) {
  if (sessionId === undefined) {
    return;
  }

  try {
    await invoke("terminal_resize", {
      id: sessionId,
      size,
    });
  } catch (error) {
    setStatus(errorToMessage(error));
  }
}

async function killTerminal(sessionId: string) {
  try {
    await invoke("terminal_kill", { id: sessionId });
  } catch {
    // The panel is already unmounting, so there is no mounted surface left for cleanup errors.
  }
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
