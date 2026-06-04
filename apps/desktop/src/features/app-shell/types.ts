import type {
  AgentThreadWorkspacePanel,
  FileEditorWorkspacePanel,
  OpenProject,
  SourceControlDiffWorkspacePanel,
} from "@/features/projects/types";

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
  panel: SourceControlDiffWorkspacePanel;
};

type FileEditorOpenRequest = {
  sequence: number;
  panel: FileEditorWorkspacePanel;
};

type AgentThreadOpenRequest = {
  sequence: number;
  panel: AgentThreadWorkspacePanel;
};

export type {
  ActiveWorkspaceState,
  AgentThreadOpenRequest,
  FileEditorOpenRequest,
  SourceControlDiffOpenRequest,
};
