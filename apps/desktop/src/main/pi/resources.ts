import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLED_SKILLS_DIR = "skills";
const moduleDir = dirname(fileURLToPath(import.meta.url));
const sourceSkillsPath = join(moduleDir, "../../../resources/skills");
// Vite moves this module from src/main/pi to out/main when it bundles the desktop.
const compiledSkillsPath = join(moduleDir, "../../resources/skills");

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
    options.resourcesPath ??
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const packagedPath =
    resourcesPath === undefined
      ? null
      : join(resourcesPath, BUNDLED_SKILLS_DIR);
  const isPackaged =
    options.isPackaged ?? (packagedPath !== null && existsSync(packagedPath));

  if (isPackaged && packagedPath !== null) return packagedPath;
  return existsSync(compiledSkillsPath) ? compiledSkillsPath : sourceSkillsPath;
}

/**
 * Drop skills from the person's own `~/.agents/skills`. Pi loads that directory
 * unconditionally, so a tool they installed for their own coding agent (for
 * example a version-control skill) would steer every Kira chat in every project.
 * Skills in a workspace's `.agents/skills` are part of that project and stay.
 */
export function withoutUserAgentsSkills<
  T extends { skills: { filePath: string }[] },
>(result: T): T {
  const userSkills = join(homedir(), ".agents", "skills") + sep;
  return {
    ...result,
    skills: result.skills.filter(
      (skill) => !skill.filePath.startsWith(userSkills),
    ),
  };
}
