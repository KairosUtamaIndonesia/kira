type ProjectSearchInput = {
  folderPath: string;
  query: string;
  isCaseSensitive: boolean;
};

type ProjectSearchResult = {
  files: ProjectSearchFileMatch[];
  matchCount: number;
  searchedFileCount: number;
  skippedFileCount: number;
  limitReached: ProjectSearchLimitReason | undefined;
};

type ProjectSearchFileMatch = {
  path: string;
  matches: ProjectSearchMatch[];
};

type ProjectSearchMatch = {
  startLineNumber: number;
  endLineNumber: number;
  preview: string;
  ranges: ProjectSearchMatchRange[];
};

type ProjectSearchMatchRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

type ProjectSearchLimitReason = "matchCount" | "matchedFileCount";

export type {
  ProjectSearchFileMatch,
  ProjectSearchInput,
  ProjectSearchLimitReason,
  ProjectSearchMatch,
  ProjectSearchMatchRange,
  ProjectSearchResult,
};
