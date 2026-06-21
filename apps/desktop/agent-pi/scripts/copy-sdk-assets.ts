import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function main(): void {
  const sdkDir = join(
    ROOT,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );

  // Destination: a dedicated pi-sdk directory alongside the server.mjs bundle.
  // PI_PACKAGE_DIR will point here in the Bun launch arm.
  const piSdkDir = join(ROOT, "dist", "pi-sdk");

  // 1. Package.json — SDK reads this for piConfig (name, configDir).
  const pkgJson = join(sdkDir, "package.json");
  const pkgJsonDest = join(piSdkDir, "package.json");
  ensureParent(pkgJsonDest);
  copyFileSync(pkgJson, pkgJsonDest);
  process.stdout.write(`copied ${pkgJson} -> ${pkgJsonDest}\n`);

  const sdkDist = join(sdkDir, "dist");

  // 2. Theme files — {PI_PACKAGE_DIR}/dist/modes/interactive/theme/*.json
  copyDir(
    join(sdkDist, "modes", "interactive", "theme"),
    join(piSdkDir, "dist", "modes", "interactive", "theme"),
    (name) => name.endsWith(".json"),
  );

  // 3. Interactive assets — {PI_PACKAGE_DIR}/dist/modes/interactive/assets/*
  copyDir(
    join(sdkDist, "modes", "interactive", "assets"),
    join(piSdkDir, "dist", "modes", "interactive", "assets"),
    () => true,
  );

  // 4. Export-html templates — {PI_PACKAGE_DIR}/dist/core/export-html/*
  copyDir(
    join(sdkDist, "core", "export-html"),
    join(piSdkDir, "dist", "core", "export-html"),
    (name) => name.endsWith(".html") || name.endsWith(".css") || name.endsWith(".js"),
  );
  // Vendor JS
  copyDir(
    join(sdkDist, "core", "export-html", "vendor"),
    join(piSdkDir, "dist", "core", "export-html", "vendor"),
    (name) => name.endsWith(".js"),
  );

  process.stdout.write(`pi-sdk assets copied to ${piSdkDir}\n`);
}

function ensureParent(filePath: string): void {
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
}

function copyDir(sourceDir: string, destDir: string, filter: (name: string) => boolean): void {
  if (!existsSync(sourceDir)) {
    process.stderr.write(`WARNING: source dir not found: ${sourceDir}\n`);
    return;
  }
  mkdirSync(destDir, { recursive: true });
  for (const name of readdirSync(sourceDir)) {
    if (filter(name)) {
      copyFileSync(join(sourceDir, name), join(destDir, name));
    }
  }
}

main();
