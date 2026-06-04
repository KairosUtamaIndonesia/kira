type Project = {
  id: string;
  name: string;
  folderPath: string;
  createdAt: string;
  updatedAt: string;
};

type Session = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  layoutJson: string | null;
};

type CreateProjectInput = {
  name: string;
  folderPath: string;
};

type CreatedProject = {
  project: Project;
  defaultSession: Session;
};

type WorkspacePanelBase = {
  id: string;
  sessionId: string;
  title: string;
  positionIndex: number;
  createdAt: string;
  updatedAt: string;
};

type WorkspacePanel =
  | TerminalWorkspacePanel
  | SourceControlDiffWorkspacePanel
  | FileEditorWorkspacePanel
  | AgentThreadWorkspacePanel;

type TerminalWorkspacePanel = WorkspacePanelBase & {
  kind: "terminal";
  terminalState: TerminalPanelState;
  sourceControlDiffState: null;
  fileEditorState: null;
  agentThreadState: null;
};

type SourceControlDiffWorkspacePanel = WorkspacePanelBase & {
  kind: "source_control_diff";
  terminalState: null;
  sourceControlDiffState: SourceControlDiffPanelState;
  fileEditorState: null;
  agentThreadState: null;
};

type FileEditorWorkspacePanel = WorkspacePanelBase & {
  kind: "file_editor";
  terminalState: null;
  sourceControlDiffState: null;
  fileEditorState: FileEditorPanelState;
  agentThreadState: null;
};

type AgentThreadWorkspacePanel = WorkspacePanelBase & {
  kind: "agent_thread";
  terminalState: null;
  sourceControlDiffState: null;
  fileEditorState: null;
  agentThreadState: AgentThreadPanelState;
};

type AgentThreadPanelState = {
  threadId: string;
};

type TerminalPanelState = {
  workingDirectory: string;
  shell: string | null;
};

type FileEditorPanelState = {
  folderPath: string;
  filePath: string;
};

type SourceControlDiffPanelState = {
  folderPath: string;
  filePath: string;
  oldPath: string | null;
  source: "staged" | "unstaged" | "untracked";
};

type CreateTerminalPanelInput = {
  sessionId: string;
  title: string;
  workingDirectory: string;
};

type CreateAgentThreadPanelInput = {
  sessionId: string;
  title: string;
};

type OpenSourceControlDiffPanelInput = {
  sessionId: string;
  title: string;
  folderPath: string;
  filePath: string;
  oldPath: string | null;
  source: SourceControlDiffPanelState["source"];
};

type OpenFileEditorPanelInput = {
  sessionId: string;
  title: string;
  folderPath: string;
  filePath: string;
};

type DeleteWorkspacePanelInput = {
  panelId: string;
};

type RenameProjectInput = {
  projectId: string;
  name: string;
};

type RemoveProjectInput = {
  projectId: string;
};

type UpdateSessionLayoutInput = {
  sessionId: string;
  layoutJson: string;
};

type TerminalSnapshot = {
  terminalId: string;
  sequence: number;
  serialized: string;
  cols: number;
  rows: number;
  capturedAt: string;
  updatedAt: string;
};

type GetTerminalSnapshotInput = {
  terminalId: string;
};

type SaveTerminalSnapshotInput = {
  terminalId: string;
  sequence: number;
  serialized: string;
  cols: number;
  rows: number;
  capturedAt: string;
};

type DeleteTerminalSnapshotInput = {
  terminalId: string;
};

type OpenProjectInput = {
  projectId: string;
};

type OpenProject = {
  project: Project;
  session: Session;
  panels: WorkspacePanel[];
};

export type {
  AgentThreadPanelState,
  AgentThreadWorkspacePanel,
  CreatedProject,
  CreateAgentThreadPanelInput,
  CreateProjectInput,
  OpenProject,
  CreateTerminalPanelInput,
  FileEditorPanelState,
  FileEditorWorkspacePanel,
  OpenFileEditorPanelInput,
  OpenSourceControlDiffPanelInput,
  DeleteTerminalSnapshotInput,
  DeleteWorkspacePanelInput,
  GetTerminalSnapshotInput,
  OpenProjectInput,
  Project,
  RemoveProjectInput,
  RenameProjectInput,
  Session,
  SaveTerminalSnapshotInput,
  SourceControlDiffPanelState,
  SourceControlDiffWorkspacePanel,
  TerminalPanelState,
  TerminalSnapshot,
  TerminalWorkspacePanel,
  UpdateSessionLayoutInput,
  WorkspacePanel,
};
