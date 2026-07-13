/**
 * AppSocketProvider — shared global WebSocket connection for the entire app.
 * Wraps the sidecar WS in a React context so any component can send/receive.
 */

import type { ClientCommand, ServerEvent } from "@kira/agent-pi/protocol";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";

const WS_URL = "ws://127.0.0.1:19876";

interface AppSocketContextValue {
  send: (cmd: ClientCommand) => void;
  connected: boolean;
  fatalError: string | undefined;
  /** Subscribe to all events. Returns unsubscribe function. */
  onEvent: (cb: (event: ServerEvent) => void) => () => void;
}

const AppSocketContext = createContext<AppSocketContextValue | undefined>(undefined);

export function AppSocketProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<WebSocket | null | undefined>(null);
  const [connected, setConnected] = useState(false);
  const [fatalError] = useState<string | undefined>();
  const handlersRef = useRef<Set<(event: ServerEvent) => void>>(new Set());
  const queueRef = useRef<ClientCommand[]>([]);
  const fatalRef = useRef(false);

  const onEvent = useCallback((cb: (event: ServerEvent) => void) => {
    handlersRef.current.add(cb);
    return () => {
      handlersRef.current.delete(cb);
    };
  }, []);

  const send = useCallback((cmd: ClientCommand) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(cmd));
    } else {
      queueRef.current.push(cmd);
    }
  }, []);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let disposed = false;

    function connect() {
      if (disposed || fatalRef.current) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        if (wsRef.current !== ws) return; // stale socket
        setConnected(true);
        // Drain queued commands
        const queue = queueRef.current;
        queueRef.current = [];
        for (const cmd of queue) {
          ws.send(JSON.stringify(cmd));
        }
      });

      ws.addEventListener("message", (event) => {
        if (wsRef.current !== ws) return; // stale socket
        try {
          const msg = JSON.parse(event.data as string) as ServerEvent;
          if (msg.type === "error") {
            // server error logged via handlers below
          }
          handlersRef.current.forEach((cb) => cb(msg));
        } catch {
          // malformed message ignored
        }
      });

      ws.addEventListener("close", () => {
        if (wsRef.current !== ws) return; // stale socket — a newer one took over
        wsRef.current = undefined;
        setConnected(false);
        if (disposed || fatalRef.current) return;
        reconnectTimer = setTimeout(connect, 1500);
      });

      ws.addEventListener("error", () => ws.close());
    }

    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      wsRef.current = undefined;
      if (ws) ws.close();
    };
  }, []);

  return (
    <AppSocketContext.Provider value={{ send, connected, fatalError, onEvent }}>
      {children}
    </AppSocketContext.Provider>
  );
}

export function useAppSocket(): AppSocketContextValue {
  const ctx = useContext(AppSocketContext);
  if (!ctx) throw new Error("useAppSocket must be used within an AppSocketProvider");
  return ctx;
}
