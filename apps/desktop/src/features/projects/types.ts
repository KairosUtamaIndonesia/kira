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

type WorkspacePanel = {
  id: string;
  sessionId: string;
  kind: "terminal";
  title: string;
  positionIndex: number;
  createdAt: string;
  updatedAt: string;
  terminalState: TerminalPanelState | null;
};

type TerminalPanelState = {
  workingDirectory: string;
  shell: string | null;
};

type CreateTerminalPanelInput = {
  sessionId: string;
  title: string;
  workingDirectory: string;
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

type OpenProjectInput = {
  projectId: string;
};

type OpenProject = {
  project: Project;
  session: Session;
  panels: WorkspacePanel[];
};

export type {
  CreatedProject,
  CreateProjectInput,
  OpenProject,
  CreateTerminalPanelInput,
  DeleteWorkspacePanelInput,
  OpenProjectInput,
  Project,
  RemoveProjectInput,
  RenameProjectInput,
  Session,
  TerminalPanelState,
  UpdateSessionLayoutInput,
  WorkspacePanel,
};
