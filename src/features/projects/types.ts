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
  kind: string;
  title: string;
  positionIndex: number;
  createdAt: string;
  updatedAt: string;
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
  OpenProjectInput,
  Project,
  Session,
  WorkspacePanel,
};
