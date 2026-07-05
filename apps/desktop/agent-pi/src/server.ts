/**
 * agent-pi entry: single global WebSocket server on fixed port 19876.
 *
 * All frontend connections share one WS. Commands carry threadId for routing.
 * The SessionHost manages project-scoped infrastructure and per-thread sessions.
 */

import { WebSocketServer } from "ws";

import type { ClientCommand } from "./protocol";

import { registerProviderExtensions } from "./kira/model-registry";
import { SessionHost } from "./kira/session-host";

const envPort = Number.parseInt(process.env.PORT ?? "", 10);
const PORT = Number.isNaN(envPort) ? 19876 : envPort;

async function main() {
  console.error("[agent-pi] starting...");
  const envCloudUrl = process.env.KIRA_CLOUD_API_URL || process.env.KIRA_CLOUD_URL;
  const envApiKey = process.env.KIRA_API_KEY;

  // Shared across all connections: providers are registered exactly once.
  let providersRegistration: Promise<void> | undefined;
  async function ensureProviders(): Promise<void> {
    if (!providersRegistration) {
      try {
        providersRegistration = registerProviderExtensions();
        await providersRegistration;
      } catch (err) {
        providersRegistration = undefined; // allow retry on next register_project
        throw err;
      }
    }
    await providersRegistration;
  }

  // If cloud config is already in the environment, register now.
  if (envCloudUrl && envApiKey) {
    await ensureProviders();
  }

  const host = new SessionHost();
  const wss = new WebSocketServer({ port: PORT });
  await new Promise<void>((resolve) => wss.once("listening", resolve));

  wss.on("connection", (ws) => {
    console.error("[agent-pi] client connected");
    // Serialize command processing per connection: open_thread must not run
    // before register_project finishes. Long-running commands (prompt/compact)
    // are dispatched fire-and-forget inside SessionHost so abort still works.
    let queue: Promise<void> = Promise.resolve();

    ws.on("message", (raw) => {
      let cmd: ClientCommand;
      try {
        cmd = JSON.parse(raw.toString()) as ClientCommand;
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Bad JSON" }));
        return;
      }
      const prev = queue;
      const threadId = "threadId" in cmd ? cmd.threadId : undefined;
      console.error(`[agent-pi] cmd: ${cmd.type}${threadId !== undefined ? ` thread=${threadId.slice(0, 8)}` : ""}`);
      queue = (async () => {
        try {
          await prev;
          // register_project carries the cloud config for provider registration
          if (cmd.type === "register_project") {
            if (!cmd.cloudApiUrl || !cmd.cloudApiKey) {
              ws.send(JSON.stringify({ type: "error", message: "Cloud config required" }));
              return;
            }
            process.env.KIRA_CLOUD_API_URL = cmd.cloudApiUrl;
            process.env.KIRA_API_KEY = cmd.cloudApiKey;
            try {
              await ensureProviders();
            } catch (err) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `Provider registration failed: ${(err as Error).message}`,
                }),
              );
              return;
            }
          }

          await host.handleCommand(ws, cmd);
        } catch (e) {
          ws.send(JSON.stringify({ type: "error", message: (e as Error).message }));
        }
      })();
    });
  });
  console.error(`[agent-pi] listening on ws://127.0.0.1:${PORT}`);

  process.on("SIGTERM", () => {
    wss.close();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    wss.close();
    process.exit(0);
  });
}

(async () => {
  try {
    await main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
