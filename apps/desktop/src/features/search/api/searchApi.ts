import { invoke } from "@tauri-apps/api/core";

import type { ProjectSearchInput, ProjectSearchLimitReason, ProjectSearchResult } from "../types";

type ProjectSearchResultBoundary = Omit<ProjectSearchResult, "limitReached"> & {
  limitReached: ProjectSearchLimitReason | null;
};

async function searchProject(input: ProjectSearchInput) {
  const result = await invoke<ProjectSearchResultBoundary>("project_search", { input });
  return {
    ...result,
    limitReached: result.limitReached ? result.limitReached : undefined,
  } satisfies ProjectSearchResult;
}

export { searchProject };
