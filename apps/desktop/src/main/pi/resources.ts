import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUNDLED_SKILLS_DIR = 'skills';
const sourceSkillsPath = join(dirname(fileURLToPath(import.meta.url)), '../../../resources/skills');

type ResourcePathOptions = {
  /** Override the packaged check in tests and in packaging tools. */
  isPackaged?: boolean;
  /** Electron's process.resourcesPath, injectable for a shipped-app test. */
  resourcesPath?: string;
};

/**
 * Locate the skills shipped with the desktop.
 *
 * Development and the compiled app can resolve the repository resource beside
 * this module. A packaged Electron app keeps `extraResources` outside its asar
 * at process.resourcesPath, so prefer that path when it exists (or when the
 * caller explicitly says this is a packaged process).
 */
export function bundledSkillsPath(options: ResourcePathOptions = {}): string {
  const resourcesPath =
    options.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const packagedPath = resourcesPath === undefined ? null : join(resourcesPath, BUNDLED_SKILLS_DIR);
  const isPackaged = options.isPackaged ?? (packagedPath !== null && existsSync(packagedPath));

  return isPackaged && packagedPath !== null ? packagedPath : sourceSkillsPath;
}
