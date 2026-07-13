/**
 * copy-sdk-assets.ts — Copies Pi SDK runtime-only assets into dist/pi-sdk/.
 *
 * The Pi SDK reads some files at runtime via readFileSync (theme JSON, export
 * templates, vendor JS). These are NOT part of the bun build --target=bun
 * bundle. This script copies them from node_modules into the bundle's dist
 * directory so they can be resolved relative to the bundled server.mjs's
 * __dirname, and so Tauri's resource bundler can include them.
 *
 * Dev:  assets land at agent-pi/dist/... which matches __dirname from the bundle
 * Prod: Tauri bundles dist/pi-sdk/ as agent-runtime/pi-sdk/; the Rust backend
 *       sets PI_PACKAGE_DIR to that path.
 */

import fs from "node:fs";
import path from "node:path";

// All SDK packages that ship runtime-read assets
const SDK_PACKAGES = [
  {
    name: "@earendil-works/pi-coding-agent",
    // Files relative to the package root (dist/ output)
    files: [
      "dist/modes/interactive/theme/dark.json",
      "dist/modes/interactive/theme/light.json",
      "dist/modes/interactive/theme/theme-schema.json",
      "dist/modes/interactive/assets/clankolas.png",
      "dist/core/export-html/template.html",
      "dist/core/export-html/template.css",
      "dist/core/export-html/template.js",
      "dist/core/export-html/vendor/marked.min.js",
      "dist/core/export-html/vendor/highlight.min.js",
    ],
  },
];

const DEST = path.resolve("dist/pi-sdk");

function copyAsset(packageName: string, file: string) {
  const src = path.resolve("node_modules", ...packageName.split("/"), file);
  const dest = path.join(DEST, file);

  if (!fs.existsSync(src)) {
    console.warn(`  [warn] SDK asset not found: ${src}`);
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

console.log("Copying Pi SDK runtime assets...");

for (const pkg of SDK_PACKAGES) {
  for (const file of pkg.files) {
    copyAsset(pkg.name, file);
  }
}

// Copy package.json so getPackageDir() can discover the package root
const sdkPackageJson = path.resolve(
  "node_modules",
  ...SDK_PACKAGES[0].name.split("/"),
  "package.json",
);
if (fs.existsSync(sdkPackageJson)) {
  fs.mkdirSync(DEST, { recursive: true });
  fs.copyFileSync(sdkPackageJson, path.join(DEST, "package.json"));
}

console.log(`Done — ${SDK_PACKAGES[0].files.length} assets copied to ${DEST}`);
