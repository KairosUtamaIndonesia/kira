// Copies the compiled agent-pi binary to `src-tauri/binaries/` with the
// target-triple suffix required by Tauri v2 sidecar convention.
//
// The binary is produced by `bun run compile` in the agent-pi directory as
// `agent-pi/dist/kira-agent-pi` (or `kira-agent-pi.exe` on Windows).
// This script renames it to `kira-agent-pi-{target-triple}{ext}` in the
// `src-tauri/binaries/` directory.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function detectTargetTriple(): string {
  const output = execSync("rustc -vV", { encoding: "utf8" });
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("host:")) {
      return trimmed.replace("host:", "").trim();
    }
  }
  throw new Error("Could not detect Rust target triple from `rustc -vV` output");
}

function main(): void {
  const targetTriple = detectTargetTriple();
  const isWin = process.platform === "win32";
  const ext = isWin ? ".exe" : "";

  // Source: compiled agent-pi binary
  const binaryName = isWin ? "kira-agent-pi.exe" : "kira-agent-pi";
  const sourcePath = join(ROOT, "agent-pi", "dist", binaryName);

  if (!existsSync(sourcePath)) {
    throw new Error(
      `Agent Pi binary not found at ${sourcePath}. Did you run "bun run compile" first?`,
    );
  }

  // Destination: sidecar location with target-triple suffix
  const destName = `kira-agent-pi-${targetTriple}${ext}`;
  const destDir = join(ROOT, "src-tauri", "binaries");
  const destPath = join(destDir, destName);

  mkdirSync(destDir, { recursive: true });
  copyFileSync(sourcePath, destPath);

  process.stdout.write(`agent-pi sidecar: ${sourcePath} → ${destPath}\n`);
}

main();
