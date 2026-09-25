#!/usr/bin/env node
/**
 * Renames pi's config directory from `.pi` to `.kira`.
 *
 * pi reads this from a single field in its own package.json:
 *
 *   const CONFIG_DIR_NAME = pkg.piConfig?.configDir || ".pi";
 *
 * which is what drives both the global agent directory (`~/.pi/agent`) and every
 * project-local resource (`<cwd>/.pi/skills`, `extensions`, `settings.json`).
 * Rewriting the field moves all of them at once. See ADR 0002.
 *
 * This runs from `postinstall` rather than as a Bun `patchedDependencies` entry
 * because that mechanism does not reach workspace dependencies: Bun applies the
 * patch to the hoisted root copy, while `apps/desktop` resolves pi through its
 * own node_modules symlink into the package store, which stays unpatched.
 *
 * It is deliberately idempotent and quiet on repeat installs. If pi is not
 * installed the script does nothing, so a partial install cannot fail here.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_DIR = '.kira';
const PACKAGE = '@earendil-works/pi-coding-agent';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Every copy of pi on disk. Deliberately filesystem-based rather than resolved:
 * pi is ESM-only, so `require.resolve` fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
 * Order does not matter; writes through a symlink land in the store, which is
 * where `apps/*` actually load pi from.
 */
function installedCopies() {
  const candidates = [join(repoRoot, 'node_modules', PACKAGE)];

  const appsDir = join(repoRoot, 'apps');
  if (existsSync(appsDir)) {
    for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(join(appsDir, entry.name, 'node_modules', PACKAGE));
    }
  }

  // Bun's package store, where the workspace symlinks point.
  const store = join(repoRoot, 'node_modules', '.bun');
  if (existsSync(store)) {
    const prefix = `${PACKAGE.replace('/', '+')}@`;
    for (const entry of readdirSync(store)) {
      if (entry.startsWith(prefix)) {
        candidates.push(join(store, entry, 'node_modules', PACKAGE));
      }
    }
  }

  return candidates.filter((dir) => existsSync(join(dir, 'package.json')));
}

let patched = 0;
for (const packageDir of installedCopies()) {
  const manifestPath = join(packageDir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.piConfig?.configDir === CONFIG_DIR) continue;
  manifest.piConfig = { ...manifest.piConfig, configDir: CONFIG_DIR };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
  patched += 1;
}

if (patched > 0) {
  console.log(`pi config directory set to ${CONFIG_DIR} (${patched} copy)`);
}
