type SkillScope = "bundled" | "project" | "global";

type SkillSourceType = "github" | "well-known";

type InstalledSkill = {
  name: string;
  description: string;
  scope: SkillScope;
  source: string | null;
  sourceType: SkillSourceType | null;
  skillPath: string | null;
  hash: string | null;
  loadedByAgent: boolean;
  conflict: boolean;
};

type BundledSource = { kind: "ready" } | { kind: "runtimeUnavailable"; reason: string };

type SkillsListResult = {
  bundled: InstalledSkill[];
  project: InstalledSkill[];
  global: InstalledSkill[];
  conflicts: string[];
  bundledSource: BundledSource;
};

type SkillsListInput = {
  projectPath?: string;
};

export type {
  BundledSource,
  InstalledSkill,
  SkillScope,
  SkillSourceType,
  SkillsListInput,
  SkillsListResult,
};
