import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";

const LOCAL_HOST = "127.0.0.1";
const MAX_PORT = 65535;

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

    server.once("error", (error) => {
      reject(error);
    });

    server.once("listening", () => {
      const address = server.address();

      if (typeof address === "string" || address === null) {
        server.close(() => {
          reject(new Error("Could not read the allocated dev server port."));
        });
        return;
      }

      server.close(() => {
        resolve(address.port);
      });
    });

    server.listen(0, LOCAL_HOST);
  });
}

function runTauri(args: readonly string[]) {
  const child = spawn("bun", ["x", "tauri", ...args], {
    env: process.env,
    shell: false,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    throw error;
  });
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

  const devUrl = `http://${LOCAL_HOST}:${devPort}`;
  const configOverride = {
    build: {
      beforeDevCommand: `bun run dev -- --host ${LOCAL_HOST} --port ${devPort} --strictPort`,
      devUrl,
    },
  };

  const env = {
    ...process.env,
    KIRA_VITE_PORT: String(devPort),
    KIRA_VITE_HMR_PORT: String(hmrPort),
  };

  const child = spawn(
    "bun",
    ["x", "tauri", "dev", "--config", JSON.stringify(configOverride), ...args],
    {
      env,
      shell: false,
      stdio: "inherit",
    },
  );

  child.on("exit", (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    throw error;
  });
}

const [command, ...args] = process.argv.slice(2);

if (command === "dev") {
  await runTauriDev(args);
} else if (command === undefined) {
  runTauri([]);
} else {
  runTauri([command, ...args]);
}
