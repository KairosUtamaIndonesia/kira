type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked";

type GitStagingArea = "staged" | "unstaged" | "untracked";

type SourceControlDiffSource = GitStagingArea;

type GitConflictOperation = "merge" | "rebase" | "cherryPick" | "unknown";

type GitStatusEntry = {
  path: string;
  status: GitFileStatus;
  area: GitStagingArea;
  oldPath: string | null;
  added: number | null;
  removed: number | null;
};

type GitUpstreamStatus = {
  hasUpstream: boolean;
  upstreamName: string | null;
  ahead: number;
  behind: number;
};

type GitRepositoryStatus = {
  branch: string | null;
  head: string | null;
  upstreamStatus: GitUpstreamStatus | null;
  conflictOperation: GitConflictOperation;
  entries: GitStatusEntry[];
};

type SourceControlStatusResult =
  | { kind: "notGitRepository" }
  | ({ kind: "gitRepository" } & GitRepositoryStatus);

type SourceControlProjectInput = {
  folderPath: string;
};

type SourceControlPathInput = SourceControlProjectInput & {
  filePath: string;
};

type SourceControlPathsInput = SourceControlProjectInput & {
  filePaths: string[];
};

type SourceControlCommitInput = SourceControlProjectInput & {
  message: string;
};

type SourceControlDiffInput = SourceControlProjectInput & {
  filePath: string;
  oldPath: string | null;
  source: SourceControlDiffSource;
};

type SourceControlDiffResult =
  | {
      kind: "text";
      originalContent: string;
      modifiedContent: string;
      originalPath: string;
      modifiedPath: string;
    }
  | {
      kind: "binary";
      originalPath: string;
      modifiedPath: string;
    };

export type {
  GitConflictOperation,
  GitFileStatus,
  GitRepositoryStatus,
  GitStagingArea,
  GitStatusEntry,
  GitUpstreamStatus,
  SourceControlCommitInput,
  SourceControlDiffInput,
  SourceControlDiffResult,
  SourceControlDiffSource,
  SourceControlPathInput,
  SourceControlPathsInput,
  SourceControlProjectInput,
  SourceControlStatusResult,
};
