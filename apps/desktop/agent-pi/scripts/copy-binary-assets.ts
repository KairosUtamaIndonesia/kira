import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The pi-coding-agent SDK, when running as a Bun-compiled binary, resolves its
// package metadata (name, version, piConfig) by reading `package.json` from the
// directory that contains the executable (`dirname(process.execPath)`). The read
// happens unconditionally at module-eval time, so a missing file crashes the
// runtime before the HTTP server can start. Ship the SDK's own `package.json`
// next to `kira-agent-pi` so the compiled runtime boots with the same metadata
// it resolves in dev (`bun run`).
const sdkPackageJson = fileURLToPath(
  import.meta.resolve("@earendil-works/pi-coding-agent/package.json"),
);
const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const target = join(distDir, "package.json");

copyFileSync(sdkPackageJson, target);
process.stdout.write(`copied ${sdkPackageJson} -> ${target}\n`);

// On Windows, bun appends `.exe` to the output file. The Tauri resource config
// references the binary without extension, so create a copy without `.exe`.
const exePath = join(distDir, "kira-agent-pi.exe");
const binPath = join(distDir, "kira-agent-pi");
if (process.platform === "win32" && existsSync(exePath) && !existsSync(binPath)) {
  copyFileSync(exePath, binPath);
  process.stdout.write(`normalized ${exePath} -> ${binPath}\n`);
}
