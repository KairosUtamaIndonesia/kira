import { invoke } from "@tauri-apps/api/core";

import type { SkillsListInput, SkillsListResult } from "../types";

function getSkillsList(input: SkillsListInput) {
  return invoke<SkillsListResult>("skills_list", { input });
}

export { getSkillsList };
