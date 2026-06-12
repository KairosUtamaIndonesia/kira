/**
 * Project detection — determines whether the current working directory
 * represents a project and resolves its name.
 */

import * as os from "node:os";
import * as path from "node:path";

import { resolveProjectsRoot } from "./paths.js";

export interface ProjectInfo {
  /** Project name (directory basename), or undefined if not in a project. */
  name: string | undefined;
  /** Path to the project-scoped memory directory, or undefined. */
  memoryDir: string | undefined;
}

export interface ProjectSkillInfo extends ProjectInfo {
  /** Path to the project-scoped skills directory, or undefined. */
  skillsDir: string | undefined;
}

/**
 * Detect project from the current working directory.
 *
 * A "project" is any directory that is not the user's home directory.
 * The project name is the directory's basename.
 * Project-scoped memory is stored at ~/.pi/agent/<projectsMemoryDir>/<projectName>/.
 */
export function detectProject(projectsMemoryDir = "projects", cwd?: string): ProjectInfo {
  const dir = cwd ?? process.cwd();
  const homeDir = os.homedir();

  // Normalize paths for comparison
  const resolved = path.resolve(dir);
  const resolvedHome = path.resolve(homeDir);

  if (
    resolved === resolvedHome ||
    resolved === "/" ||
    !resolved ||
    resolved === resolvedHome + "/"
  ) {
    return { name: undefined, memoryDir: undefined };
  }

  const name = path.basename(resolved);
  if (!name || name === "." || name === "..") {
    return { name: undefined, memoryDir: undefined };
  }

  return {
    name,
    memoryDir: path.join(resolveProjectsRoot(projectsMemoryDir), name),
  };
}

export function detectProjectSkills(
  projectsMemoryDir = "projects",
  cwd?: string,
): ProjectSkillInfo {
  const project = detectProject(projectsMemoryDir, cwd);
  return {
    ...project,
    skillsDir: project.memoryDir ? path.join(project.memoryDir, "skills") : undefined,
  };
}
