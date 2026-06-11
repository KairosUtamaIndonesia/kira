import { invoke } from "@tauri-apps/api/core";

import type { SkillsListInput, SkillsListResult } from "../types";

type SkillExpansionInput = {
  name: string;
  projectPath?: string;
};

type SkillExpansionResult = {
  name: string;
  body: string;
  location: string | null;
  scope: "bundled" | "project" | "global";
};

function getSkillsList(input: SkillsListInput) {
  return invoke<SkillsListResult>("skills_list", { input });
}

function expandSkill(input: SkillExpansionInput) {
  return invoke<SkillExpansionResult>("skills_expand", { input });
}

export { expandSkill, getSkillsList };
export type { SkillExpansionInput, SkillExpansionResult };
