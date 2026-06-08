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

type FileEditorFocusRequest = {
  sequence: number;
  lineNumber: number;
  column: number;
};

type FileEditorOpenRequest = {
  sequence: number;
  panel: FileEditorWorkspacePanel;
  focusRequest: FileEditorFocusRequest | undefined;
};

type AgentThreadOpenRequest = {
  sequence: number;
  panel: AgentThreadWorkspacePanel;
};

type AgentThreadOperationRequest = {
  sequence: number;
  panelId: string;
  operation: "close" | "delete" | "rename";
  title?: string;
};

export type {
  ActiveWorkspaceState,
  AgentThreadOpenRequest,
  AgentThreadOperationRequest,
  FileEditorFocusRequest,
  FileEditorOpenRequest,
  SourceControlDiffOpenRequest,
};
