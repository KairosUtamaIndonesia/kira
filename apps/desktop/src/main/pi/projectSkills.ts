/**
 * A project's skills, written into the folder a chat works in.
 *
 * A skill is held by the server (docs/adr/0027-project-skills-live-in-the-store.md)
 * and reaches pi the only way pi reads anything: as files under the chat's
 * working directory. This module is that last step — it turns the skills the
 * server answered with into directories, and it owns the directory it does it
 * in.
 *
 * The directory is deliberately not `cwd/.kira/skills`. That is pi's own
 * project root, where the person's own skills live, and a Kira write there
 * would be a Kira write into their things. `cwd/.kira/project-skills` is Kira's
 * alone, and it reaches pi through `additionalSkillPaths` — the same route the
 * bundled skills already take, which is also the route that does not depend on
 * the folder being trusted.
 *
 * The frontmatter is written here rather than carried from the server, because
 * pi decides whether a skill is loadable from it: a skill with no description
 * does not load at all. The server refuses those, and this writes the one shape
 * pi is known to accept, so neither half has to guess what the other meant.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { ProjectSkill } from '../../preload/bridge.ts';

export type { ProjectSkill, ProjectSkillFile } from '../../preload/bridge.ts';

const PROJECT_SKILLS_DIR = join('.kira', 'project-skills');
const BODY_FILENAME = 'SKILL.md';

/** Kira's own directory for a workspace's project skills. */
export function projectSkillsPath(cwd: string): string {
  return join(cwd, PROJECT_SKILLS_DIR);
}

/**
 * Write `skills` into the folder and answer the directory they are in, or null
 * when there are none to write.
 *
 * The directory is replaced rather than merged, so a skill a project has since
 * removed stops being offered to the model — which is the whole point of the
 * store being the source of truth. A null answer is what tells the caller not
 * to hand pi a path, because a path that does not exist is an error diagnostic
 * in every session afterwards.
 */
export function materializeProjectSkills(cwd: string, skills: ProjectSkill[]): string | null {
  const root = projectSkillsPath(cwd);
  rmSync(root, { recursive: true, force: true });
  if (skills.length === 0) return null;

  for (const skill of skills) {
    const dir = join(root, skill.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, BODY_FILENAME), skillMarkdown(skill));

    for (const file of skill.files) {
      const target = resolve(dir, file.path);
      // The server refuses a path that leaves the skill, so reaching this means
      // a bug or a server that is not Kira's. Refusing here rather than writing
      // is the point: this is the last place before the file exists.
      if (!target.startsWith(dir + sep)) {
        throw new Error(`Skill ${skill.name} has a file outside its directory: ${file.path}`);
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
  }

  return root;
}

/** A skill as one `SKILL.md`, with the frontmatter pi reads it by. */
export function skillMarkdown(skill: ProjectSkill): string {
  return `---\nname: ${skill.name}\ndescription: ${inlineScalar(skill.description)}\n---\n\n${skill.body}`;
}

/**
 * A description as a YAML scalar that cannot mean anything but itself.
 *
 * Always quoted, with the escapes a double-quoted scalar needs, and with its
 * line breaks flattened: a description is the one line pi offers a skill with,
 * and an unquoted colon, quote or newline is how a person's sentence would
 * otherwise turn into frontmatter that does not parse — which pi reports as the
 * skill not loading at all.
 */
function inlineScalar(value: string): string {
  const flat = value.replace(/\r\n|\r|\n/g, ' ');
  return `"${flat.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}