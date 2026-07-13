/**
 * tauri.ts — dev workflow orchestrator.
 *
 * Starts three processes concurrently:
 *   1. agent-pi sidecar (WebSocket on :19876)
 *   2. Vite dev server
 *   3. Tauri desktop app
 *
 * No env var dance, no port negotiation, no health polling.
 * The sidecar starts a fixed port 19876 — if it's not running,
 * the frontend shows "Reconnecting...".
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const LOCAL_HOST = "127.0.0.1";
const MAX_PORT = 65535;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const BUN_EXECUTABLE = process.argv[0];
const AGENT_PI_DIR = path.resolve(scriptDir, "../agent-pi");

function parsePort(value: string) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function findAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => reject(error));
    server.once("listening", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close(() => reject(new Error("Could not read port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
    server.listen(0, LOCAL_HOST);
  });
}

function spawnAndPipe(command: string, args: string[], cwd?: string, env?: Record<string, string>) {
  const child = spawn(command, args, {
    cwd,
    env: { ...(env ?? process.env), PATH: process.env.PATH },
    shell: true,
    stdio: "inherit",
  });
  child.on("error", (error) => {
    throw error;
  });
  return child;
}

async function runTauriDev(args: readonly string[]) {
  const devPort = process.env.KIRA_VITE_PORT
    ? parsePort(process.env.KIRA_VITE_PORT)
    : await findAvailablePort();
  const hmrPort = process.env.KIRA_VITE_HMR_PORT
    ? parsePort(process.env.KIRA_VITE_HMR_PORT)
    : await findAvailablePort();

  if (devPort === hmrPort) {
    throw new Error("Vite dev and HMR ports must be different.");
  }

  const agentDir =
    process.env.KIRA_AGENT_DIR ??
    `${process.env.APPDATA ?? `${process.env.HOME}/.config`}/kira/agent`;

  // Read cloud config from .env file (KIRA_CLOUD_URL) so the sidecar can
  // fetch the model catalog from the admin panel. The API key comes from
  // the shell (set manually for dev; prod passes it from Rust).
  const envPath = path.resolve(scriptDir, "../src-tauri/.env");
  let cloudUrl = process.env.KIRA_CLOUD_API_URL ?? process.env.KIRA_CLOUD_URL;
  if (!cloudUrl && fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, "utf-8").match(/^KIRA_CLOUD_URL=(.+)$/m);
    if (m) cloudUrl = m[1].trim();
  }

  const env = {
    ...process.env,
    KIRA_CLOUD_API_URL: cloudUrl ?? "",
    KIRA_API_KEY: process.env.KIRA_API_KEY ?? "",
    KIRA_AGENT_DIR: agentDir,
    KIRA_VITE_PORT: String(devPort),
    KIRA_VITE_HMR_PORT: String(hmrPort),
  };

  // 1. Start agent-pi sidecar
  process.stderr.write("[tauri.ts] starting agent-pi on :19876...\n");
  const sidecar = spawnAndPipe(BUN_EXECUTABLE, ["run", "src/server.ts"], AGENT_PI_DIR, env);

  // 2. Start Vite dev server
  process.stderr.write(`[tauri.ts] starting Vite on :${devPort}...\n`);
  const vite = spawnAndPipe(
    BUN_EXECUTABLE,
    ["run", "dev", "--", "--host", LOCAL_HOST, "--port", String(devPort), "--strictPort"],
    undefined,
    env,
  );

  // 3. Start Tauri dev
  const devUrl = `http://${LOCAL_HOST}:${devPort}`;
  const configOverride = JSON.stringify({ build: { beforeDevCommand: "", devUrl } });
  process.stderr.write("[tauri.ts] starting Tauri...\n");
  const tauri = spawn(BUN_EXECUTABLE, ["x", "tauri", "dev", "--config", configOverride, ...args], {
    env: { ...(env ?? process.env), PATH: process.env.PATH },
    shell: false,
    stdio: "inherit",
  });
  tauri.on("error", (error) => {
    throw error;
  });

  // When any process exits, kill the others
  const cleanup = () => {
    if (!sidecar.killed) sidecar.kill();
    if (!vite.killed) vite.kill();
    if (!tauri.killed) tauri.kill();
  };

  sidecar.on("exit", (code, signal) => {
    cleanup();
    exitProcess(code, signal);
  });
  vite.on("exit", (code, signal) => {
    cleanup();
    exitProcess(code, signal);
  });
  tauri.on("exit", (code, signal) => {
    cleanup();
    exitProcess(code, signal);
  });
}

function exitProcess(code: number | null, signal: string | null) {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
}

const [command, ...args] = process.argv.slice(2);

if (command === "dev") {
  await runTauriDev(args);
} else if (command === undefined) {
  // No command: just run `bun x tauri` with the args (e.g., `bun scripts/tauri.ts build`)
  spawnAndPipe(BUN_EXECUTABLE, ["x", "tauri", ...args]);
} else {
  spawnAndPipe(BUN_EXECUTABLE, ["x", "tauri", command, ...args]);
}
