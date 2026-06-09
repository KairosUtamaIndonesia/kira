import type { SkillReference } from "@flue/runtime";

/**
 * Bundled Skills compiled into Kira's agent-runtime. Each entry is a `SKILL.md`
 * imported with the `skill` import attribute, e.g.:
 *
 *   import review from "../../skills/review/SKILL.md" with { type: "skill" };
 *
 * Add the imported reference to this array. It becomes the single source of
 * truth: registered on Kira's coding agent (always loaded, independent of any
 * Project workspace) and reported by `GET /app/skills` for the Skills inspector.
 *
 * A Bundled Skill that shares a declared name with a Project Skill discovered
 * under `<cwd>/.agents/skills/` is a Skill Conflict: Flue fails session
 * initialization rather than resolving it implicitly.
 */
export const bundledSkills: readonly SkillReference[] = [];

/** Bundled Skill metadata surfaced to the desktop Skills inspector. */
export type BundledSkillSummary = {
  name: string;
  description: string;
};

/** Project the bundled references down to the name/description the inspector renders. */
export function bundledSkillSummaries(): BundledSkillSummary[] {
  return bundledSkills.map((skill) => ({
    name: skill.name,
    description: skill.description,
  }));
}
