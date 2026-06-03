import type { OpenProject } from "@/features/projects/types";
import type { SourceControlDiffSource } from "@/features/source-control/types";

type ProjectSwitchState =
  | { status: "idle" }
  | { status: "switching"; projectId: string }
  | { status: "error"; projectId: string; message: string };

type ActiveWorkspaceState =
  | { status: "none" }
  | { status: "loading"; projectId: string }
  | ({ status: "active"; projectSwitch: ProjectSwitchState } & OpenProject)
  | { status: "error"; projectId: string; message: string };

type SourceControlDiffOpenRequest = {
  sequence: number;
  projectId: string;
  title: string;
  folderPath: string;
  filePath: string;
  oldPath: string | null;
  source: SourceControlDiffSource;
};

export type { ActiveWorkspaceState, SourceControlDiffOpenRequest };
