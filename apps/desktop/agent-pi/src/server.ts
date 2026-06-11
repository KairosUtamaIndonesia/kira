import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";

import app from "./app";
import { getOrCreateAgentSession } from "./kira/agent-session-host";
import { requireAgentThreadContext } from "./kira/agent-thread-context";
import { readRuntimeToken } from "./kira/env";
import { attachAgentSocket } from "./kira/ws-transport";

const AGENT_SOCKET_PATH = /^\/agents\/([^/]+)\/ws$/;

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "0", 10);

const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  process.stdout.write(`@kira/agent-pi listening on http://${host}:${info.port}\n`);
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
  const url = new URL(request.url ?? "", `http://${host}`);
  const match = AGENT_SOCKET_PATH.exec(url.pathname);
  if (match === null) {
    socket.destroy();
    return;
  }

  if (url.searchParams.get("token") !== readRuntimeToken()) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const threadId = decodeURIComponent(match[1] ?? "");
  let context;
  try {
    context = requireAgentThreadContext(threadId);
  } catch {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  void (async () => {
    try {
      const sessionHost = await getOrCreateAgentSession(context);
      wss.handleUpgrade(request, socket, head, (ws) =>
        attachAgentSocket(ws, sessionHost.session, sessionHost.toolUiBroker),
      );
    } catch (error) {
      process.stderr.write(
        `agent session build failed: ${error instanceof Error ? error.stack : String(error)}\n`,
      );
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  })();
});
